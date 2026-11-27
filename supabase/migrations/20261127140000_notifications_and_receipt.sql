-- =====================================================================
-- Notifications foundation + order receipt.
-- Run once, after 20261127130000_security_hardening.sql.
--
-- Adds:
--   1. shop_notification_settings — where each shop wants new-order alerts
--      (email list now, push later). Owners only.
--   2. device_push_tokens — phone/browser push tokens (for the future app
--      or PWA). Each user manages only their own.
--   3. notification_outbox — one row per message to send. Filled
--      automatically by a trigger when an order is created, so no order
--      is ever missed, even if sending fails. A server-side sender
--      (lib/notifications) picks rows up and sends them.
--   4. claim_notifications() — lets ONLY the server (service_role) take
--      a batch of rows to send, safely (no double sending).
--   5. place_order() now also returns the order lines + customer name +
--      area, for the success page and WhatsApp message.
--      Still never returns confirm_token.
-- =====================================================================


-- =====================================================================
-- 1. TABLES
-- =====================================================================

-- Checks a list of email addresses: max 10, each looks like an email.
create function private.is_valid_email_list(p_emails text[])
returns boolean
language sql immutable set search_path = ''
as $$
  select coalesce(cardinality(p_emails), 0) <= 10
     and coalesce(bool_and(
           char_length(e) <= 254
           and e ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
         ), true)
  from unnest(p_emails) as e;
$$;

-- ---------- shop_notification_settings -------------------------------
create table public.shop_notification_settings (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  shop_id        uuid not null unique references public.shops (id) on delete cascade,
  -- Who gets an email for each new order.
  order_emails   text[] not null default '{}'
                 check (private.is_valid_email_list(order_emails)),
  email_enabled  boolean not null default true,
  push_enabled   boolean not null default false
);

-- ---------- device_push_tokens ----------------------------------------
create table public.device_push_tokens (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  user_id       uuid not null default auth.uid()
                references auth.users (id) on delete cascade,
  shop_id       uuid not null references public.shops (id) on delete cascade,
  platform      text not null check (platform in ('ios', 'android', 'web')),
  token         text not null check (char_length(token) between 1 and 4096),
  last_seen_at  timestamptz not null default now(),
  unique (user_id, shop_id, token)
);
create index device_push_tokens_shop_idx on public.device_push_tokens (shop_id);

-- ---------- notification_outbox ---------------------------------------
create table public.notification_outbox (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  shop_id      uuid not null references public.shops (id) on delete cascade,
  order_id     uuid not null,
  event_type   text not null check (event_type in ('order.created')),
  channel      text not null check (channel in ('email', 'push')),
  -- email address, or device_push_tokens.id for push
  recipient    text not null check (char_length(recipient) between 1 and 4096),
  -- pending → sending → sent, or back to pending to retry; failed after 3 tries
  status       text not null default 'pending'
               check (status in ('pending', 'sending', 'sent', 'failed')),
  attempts     integer not null default 0 check (attempts >= 0),
  last_error   text check (char_length(last_error) <= 2000),
  claimed_at   timestamptz,
  sent_at      timestamptz,
  -- never queue the same message twice
  unique (order_id, event_type, channel, recipient),
  foreign key (order_id, shop_id)
    references public.orders (id, shop_id) on delete cascade
);
create index notification_outbox_due_idx
  on public.notification_outbox (created_at)
  where status in ('pending', 'sending');
create index notification_outbox_shop_idx
  on public.notification_outbox (shop_id, created_at desc);


-- =====================================================================
-- 2. TRIGGERS
-- =====================================================================

-- Every shop gets a settings row automatically.
create function private.create_shop_notification_settings()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.shop_notification_settings (shop_id)
  values (new.id)
  on conflict (shop_id) do nothing;
  return new;
end;
$$;

create trigger shops_create_notification_settings
  after insert on public.shops
  for each row execute function private.create_shop_notification_settings();

-- Shops that already exist get one now.
insert into public.shop_notification_settings (shop_id)
select s.id from public.shops s
on conflict (shop_id) do nothing;

-- Every new order → one outbox row per enabled channel + recipient.
-- Runs inside the same transaction as the order: if the order is saved,
-- its notifications are saved too.
create function private.enqueue_order_created()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_settings public.shop_notification_settings%rowtype;
begin
  select * into v_settings
  from public.shop_notification_settings s
  where s.shop_id = new.shop_id;

  if not found then
    return new;
  end if;

  if v_settings.email_enabled then
    insert into public.notification_outbox (shop_id, order_id, event_type, channel, recipient)
    select new.shop_id, new.id, 'order.created', 'email', x.email
    from (
      select distinct lower(trim(e)) as email
      from unnest(v_settings.order_emails) as e
    ) as x
    where x.email <> ''
    on conflict do nothing;
  end if;

  if v_settings.push_enabled then
    -- one row per device of a CURRENT member of this shop
    insert into public.notification_outbox (shop_id, order_id, event_type, channel, recipient)
    select new.shop_id, new.id, 'order.created', 'push', t.id::text
    from public.device_push_tokens t
    join public.shop_members m
      on m.user_id = t.user_id and m.shop_id = t.shop_id
    where t.shop_id = new.shop_id
    on conflict do nothing;
  end if;

  return new;
end;
$$;

create trigger orders_enqueue_order_created
  after insert on public.orders
  for each row execute function private.enqueue_order_created();


-- =====================================================================
-- 3. claim_notifications — server only
-- =====================================================================
-- Takes up to p_limit messages that are due, marks them "sending" and
-- counts the attempt. SKIP LOCKED means two servers running at the same
-- time never take the same row. Rows stuck in "sending" for 10+ minutes
-- (e.g. the server crashed) become due again. Max 3 attempts.
create function public.claim_notifications(p_limit integer default 20)
returns setof public.notification_outbox
language sql security invoker set search_path = ''
as $$
  update public.notification_outbox o
     set status     = 'sending',
         attempts   = o.attempts + 1,
         claimed_at = now()
   where o.id in (
     select q.id
     from public.notification_outbox q
     where q.attempts < 3
       and (q.status = 'pending'
            or (q.status = 'sending' and q.claimed_at < now() - interval '10 minutes'))
     order by q.created_at
     limit least(greatest(coalesce(p_limit, 20), 1), 100)
     for update skip locked
   )
  returning o.*;
$$;


-- =====================================================================
-- 4. place_order — same rules as before, now also returns the receipt
-- =====================================================================
create or replace function public.place_order(
  p_shop_slug        text,
  p_customer_name    text,
  p_customer_phone   text,
  p_customer_area    text,
  p_customer_address text,
  p_items            jsonb,
  p_notes            text default null,
  p_payment_method   text default 'cod'
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  c_max_qty_per_item constant integer := 20;
  c_max_entries      constant integer := 30;
  v_shop          public.shops%rowtype;
  v_phone         text;
  v_customer_id   uuid;
  v_order_id      uuid;
  v_order_number  integer;
  v_subtotal      numeric(10,2) := 0;
  v_lines         jsonb := '[]'::jsonb;
  v_item          record;
  v_product       public.products%rowtype;
  v_variant       public.product_variants%rowtype;
  v_variant_id    uuid;
  v_price         numeric(10,2);
  v_name          text;
begin
  -- ---- 1. Check the input ------------------------------------------
  select * into v_shop
  from public.shops s
  where s.slug = lower(trim(p_shop_slug)) and s.is_active;
  if not found then
    raise exception 'Shop not found';
  end if;

  if coalesce(trim(p_customer_name), '') = '' then
    raise exception 'Please enter your name';
  end if;
  if char_length(trim(p_customer_name)) > 100 then
    raise exception 'Name is too long';
  end if;
  if coalesce(trim(p_customer_address), '') = '' then
    raise exception 'Please enter your delivery address';
  end if;
  if char_length(trim(p_customer_address)) > 500
     or char_length(coalesce(trim(p_customer_area), '')) > 100
     or char_length(coalesce(trim(p_notes), '')) > 2000 then
    raise exception 'Some of the text is too long';
  end if;

  v_phone := private.normalize_lb_phone(p_customer_phone);  -- raises if invalid

  if coalesce(p_payment_method, '') not in ('cod', 'whish') then
    raise exception 'Invalid payment method';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 then
    raise exception 'Your cart is empty';
  end if;
  if jsonb_array_length(p_items) > c_max_entries then
    raise exception 'Too many items in one order (max %)', c_max_entries;
  end if;

  -- Check EVERY cart entry on its own, before anything is merged.
  if exists (
    select 1
    from jsonb_array_elements(p_items) as e
    where jsonb_typeof(e) <> 'object'
       or jsonb_typeof(e -> 'product_id') is distinct from 'string'
       or (e ->> 'product_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or (e ? 'variant_id'
           and jsonb_typeof(e -> 'variant_id') <> 'null'
           and (jsonb_typeof(e -> 'variant_id') <> 'string'
                or (e ->> 'variant_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'))
  ) then
    raise exception 'Invalid item in cart';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) as e,
         lateral (select case when jsonb_typeof(e -> 'quantity') = 'number'
                              then (e ->> 'quantity')::numeric end as q) as x
    where x.q is null
       or x.q <> trunc(x.q)
       or x.q < 1
       or x.q > c_max_qty_per_item
  ) then
    raise exception 'Each quantity must be a whole number from 1 to %', c_max_qty_per_item;
  end if;

  -- ---- 2. Create the customer, or reuse the existing one --------------
  insert into public.customers (shop_id, name, phone, area, address)
  values (v_shop.id, trim(p_customer_name), v_phone,
          nullif(trim(p_customer_area), ''), trim(p_customer_address))
  on conflict (shop_id, phone) do update
    set area    = coalesce(excluded.area, public.customers.area),
        address = excluded.address
  returning id into v_customer_id;

  -- ---- 3. Create the order (totals filled in at the end) ------------
  insert into public.orders (shop_id, customer_id, delivery_fee, payment_method,
                             delivery_area, delivery_address, notes)
  values (v_shop.id, v_customer_id, v_shop.delivery_fee, p_payment_method,
          nullif(trim(p_customer_area), ''), trim(p_customer_address),
          nullif(trim(p_notes), ''))
  returning id, order_number into v_order_id, v_order_number;

  -- ---- 4. Add each item, using REAL prices and checking stock -------
  for v_item in
    select (e ->> 'product_id')::uuid                         as product_id,
           (nullif(e ->> 'variant_id', ''))::uuid              as variant_id,
           sum((e ->> 'quantity')::numeric::integer)           as quantity
    from jsonb_array_elements(p_items) as e
    group by 1, 2
    order by 1, 2
  loop
    if v_item.quantity > c_max_qty_per_item then
      raise exception 'You can order at most % of each item', c_max_qty_per_item;
    end if;

    select * into v_product
    from public.products p
    where p.id = v_item.product_id
      and p.shop_id = v_shop.id
      and p.is_active
    for update;
    if not found then
      raise exception 'A product in your cart is no longer available';
    end if;

    if exists (select 1 from public.product_variants pv where pv.product_id = v_product.id) then
      if v_item.variant_id is null then
        raise exception 'Please choose a % for %',
          lower(coalesce(v_product.option_label, 'option')), v_product.name;
      end if;

      select * into v_variant
      from public.product_variants pv
      where pv.id = v_item.variant_id
        and pv.product_id = v_product.id
        and pv.shop_id = v_shop.id
      for update;
      if not found then
        raise exception 'An option in your cart is no longer available';
      end if;

      if v_variant.stock is not null then
        if v_variant.stock < v_item.quantity then
          if v_variant.stock = 0 then
            raise exception '% (%) is out of stock', v_product.name, v_variant.label;
          else
            raise exception 'Only % left of % (%)',
              v_variant.stock, v_product.name, v_variant.label;
          end if;
        end if;

        update public.product_variants pv
          set stock = pv.stock - v_item.quantity
        where pv.id = v_variant.id;
      end if;

      v_variant_id := v_variant.id;
      v_price      := coalesce(v_variant.price_override, v_product.price);
      v_name       := v_product.name || ' — '
                      || coalesce(v_product.option_label || ': ', '') || v_variant.label;
    else
      if v_item.variant_id is not null then
        raise exception 'An option in your cart is no longer available';
      end if;

      if v_product.stock is not null then
        if v_product.stock < v_item.quantity then
          if v_product.stock = 0 then
            raise exception '% is out of stock', v_product.name;
          else
            raise exception 'Only % left of %', v_product.stock, v_product.name;
          end if;
        end if;

        update public.products p
          set stock = p.stock - v_item.quantity
        where p.id = v_product.id;
      end if;

      v_variant_id := null;
      v_price      := v_product.price;
      v_name       := v_product.name;
    end if;

    insert into public.order_items
      (shop_id, order_id, product_id, variant_id, name_snapshot, price_snapshot, quantity)
    values
      (v_shop.id, v_order_id, v_product.id, v_variant_id, v_name, v_price, v_item.quantity);

    v_subtotal := v_subtotal + v_price * v_item.quantity;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'name',       v_name,
      'quantity',   v_item.quantity,
      'unit_price', v_price,
      'line_total', v_price * v_item.quantity
    ));
  end loop;

  -- ---- 5. Save totals -------------------------------------------------
  update public.orders o
    set subtotal = v_subtotal,
        total    = v_subtotal + o.delivery_fee
  where o.id = v_order_id;

  -- Receipt for the person who just ordered. Only what they typed or
  -- bought — never confirm_token or other customers' data.
  return jsonb_build_object(
    'order_id',       v_order_id,
    'order_number',   v_order_number,
    'items',          v_lines,
    'subtotal',       v_subtotal,
    'delivery_fee',   v_shop.delivery_fee,
    'total',          v_subtotal + v_shop.delivery_fee,
    'customer_name',  trim(p_customer_name),
    'delivery_area',  nullif(trim(p_customer_area), ''),
    'payment_method', p_payment_method
  );
end;
$$;


-- =====================================================================
-- 5. ROW LEVEL SECURITY
-- =====================================================================
alter table public.shop_notification_settings enable row level security;
alter table public.device_push_tokens         enable row level security;
alter table public.notification_outbox        enable row level security;

-- Settings: OWNERS of the shop only (staff and everyone else: nothing).
create policy "Owners can view their notification settings"
  on public.shop_notification_settings for select to authenticated
  using (private.is_shop_owner(shop_id));

create policy "Owners can change their notification settings"
  on public.shop_notification_settings for update to authenticated
  using (private.is_shop_owner(shop_id))
  with check (private.is_shop_owner(shop_id));

-- Push tokens: each user sees and manages only THEIR OWN tokens, and only
-- for shops they belong to.
create policy "Users can view their own push tokens"
  on public.device_push_tokens for select to authenticated
  using (user_id = (select auth.uid()));

create policy "Users can add their own push tokens"
  on public.device_push_tokens for insert to authenticated
  with check (user_id = (select auth.uid()) and private.is_shop_member(shop_id));

create policy "Users can update their own push tokens"
  on public.device_push_tokens for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and private.is_shop_member(shop_id));

create policy "Users can remove their own push tokens"
  on public.device_push_tokens for delete to authenticated
  using (user_id = (select auth.uid()));

-- Outbox: members can READ their shop's rows (e.g. "email sent?").
-- Nobody but the server can write.
create policy "Members can view their shop's notifications"
  on public.notification_outbox for select to authenticated
  using (private.is_shop_member(shop_id));


-- =====================================================================
-- 6. GRANTS
-- =====================================================================
revoke all on public.shop_notification_settings, public.device_push_tokens,
              public.notification_outbox
  from public, anon, authenticated;

revoke all on function private.is_valid_email_list(text[])          from public, anon, authenticated;
revoke all on function private.create_shop_notification_settings()  from public, anon, authenticated;
revoke all on function private.enqueue_order_created()              from public, anon, authenticated;
revoke all on function public.claim_notifications(integer)          from public, anon, authenticated;
revoke all on function public.place_order(text, text, text, text, text, jsonb, text, text)
  from public, anon, authenticated;

-- The email-list check runs when an owner saves their settings.
grant execute on function private.is_valid_email_list(text[]) to authenticated, service_role;

-- anon: nothing new (place_order stays as before).
grant execute on function public.place_order(text, text, text, text, text, jsonb, text, text)
  to anon, authenticated;

-- authenticated (RLS above limits the rows):
grant select on public.shop_notification_settings to authenticated;
grant update (order_emails, email_enabled, push_enabled)
  on public.shop_notification_settings to authenticated;
grant select, insert, delete on public.device_push_tokens to authenticated;
grant update (last_seen_at) on public.device_push_tokens to authenticated;
grant select on public.notification_outbox to authenticated;

-- service_role (trusted server code only — the notification sender):
grant all on public.shop_notification_settings, public.device_push_tokens,
             public.notification_outbox
  to service_role;
grant execute on function public.claim_notifications(integer) to service_role;
