-- =====================================================================
-- Step 6 — Migration 2 of 3: orders become Kefada-style invoices.
-- Run once, after 20261128100000_catalog_settings_money.sql.
--
-- Status flow:
--   unconfirmed ─confirm─► pending ─mark paid─► paid
--        └─cancel (reason)──┤        └─mark refused─► refused
--                           └─cancel (reason)─► cancelled
--   * New website orders start as "unconfirmed" (stock is held).
--   * Manual invoices (source = 'manual', Step 12) start as "pending".
--   * paid, cancelled, refused are final. One exception, for Step 12:
--     a future edit_order() function may move paid → pending to edit a
--     paid invoice. It must set the setting app.reopen_paid_order = 'on'
--     inside its own transaction; a direct UPDATE can never do it.
--
-- Adds:
--   1. New statuses (existing orders mapped safely) + status guard
--   2. New order fields (source, method, address parts, discount,
--      extra_fees, cancel_reason, paid_at, policy_accepted_at,
--      email_status, display_number like KF-0001)
--   3. Order line fields (code, option_label, list_price, cost, photo)
--      + cost rule (copied at creation, filled once later, then locked)
--   4. order_history (written automatically)
--   5. Stock given back on cancel / refuse
--   6. delivery_outcomes: paid → delivered, refused → refused
--   7. confirm_order, mark_paid, cancel_order, mark_refused (members)
--   8. Product reviews from real buyers only (server-only submit_review)
--
-- Members can no longer insert/update orders or order lines directly
-- (except order notes): status changes go through the functions above;
-- manual invoices and edits come as functions in Step 12.
-- =====================================================================


-- =====================================================================
-- 1. HELPERS
-- =====================================================================
-- extra_fees: a list of {label, amount}, e.g. [{"label":"Exchange fee","amount":2}]
create function private.is_valid_extra_fees(p_fees jsonb)
returns boolean
language plpgsql immutable set search_path = ''
as $$
begin
  if p_fees is null or jsonb_typeof(p_fees) <> 'array' or jsonb_array_length(p_fees) > 10 then
    return false;
  end if;
  return coalesce((
    select bool_and(
      jsonb_typeof(e) = 'object'
      and jsonb_typeof(e -> 'label') = 'string'
      and char_length(trim(e ->> 'label')) between 1 and 50
      and jsonb_typeof(e -> 'amount') = 'number'
      and (e ->> 'amount')::numeric > 0
      and (e ->> 'amount')::numeric <= 100000
    )
    from jsonb_array_elements(p_fees) as e
  ), true);
end;
$$;

create function private.extra_fees_total(p_fees jsonb)
returns numeric
language sql immutable set search_path = ''
as $$
  select coalesce(sum((e ->> 'amount')::numeric), 0)
  from jsonb_array_elements(case when jsonb_typeof(p_fees) = 'array' then p_fees else '[]'::jsonb end) as e;
$$;


-- =====================================================================
-- 2. DELIVERY OUTCOMES follow the new statuses
-- =====================================================================
-- (replaced BEFORE statuses are renamed, so no history is lost)
create or replace function private.record_delivery_outcome()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_phone text;
begin
  if new.status in ('paid', 'refused') then
    select c.phone into v_phone
    from public.customers c
    where c.id = new.customer_id;

    insert into public.delivery_outcomes (phone_hash, shop_id, order_id, outcome)
    values (private.phone_hash(v_phone), new.shop_id, new.id,
            case new.status when 'paid' then 'delivered' else 'refused' end)
    on conflict (order_id)
      do update set outcome = excluded.outcome, phone_hash = excluded.phone_hash;
  else
    delete from public.delivery_outcomes d where d.order_id = new.id;
  end if;
  return new;
end;
$$;


-- =====================================================================
-- 3. ORDER FIELDS + STATUS MIGRATION
-- =====================================================================
alter table public.orders drop constraint orders_status_check;

alter table public.orders
  add column source              text not null default 'website' check (source in ('website', 'manual')),
  add column method              text not null default 'delivery' check (method in ('pickup', 'delivery')),
  add column governorate         text references public.lebanon_governorates (name) on update cascade,
  add column district            text,
  add column city                text check (char_length(city) <= 100),
  add column neighbourhood       text check (char_length(neighbourhood) <= 100),
  add column street              text check (char_length(street) <= 200),
  add column details             text check (char_length(details) <= 500),
  add column discount            numeric(10,2) not null default 0 check (discount >= 0),
  add column extra_fees          jsonb not null default '[]'::jsonb check (private.is_valid_extra_fees(extra_fees)),
  add column cancel_reason       text check (char_length(trim(cancel_reason)) between 1 and 500),
  add column paid_at             timestamptz,
  add column policy_accepted_at  timestamptz,
  add column email_status        text not null default 'none'
                                 check (email_status in ('none', 'pending', 'sent', 'failed')),
  add column display_number      text check (display_number ~ '^[A-Za-z0-9][A-Za-z0-9-]{0,29}$'),
  add constraint orders_district_fk foreign key (governorate, district)
    references public.lebanon_districts (governorate, name) on update cascade;

-- Old orders: area/address move into the new address fields.
alter table public.orders alter column delivery_address drop not null;

-- Map existing statuses (old → new).
update public.orders
   set status = case status
                  when 'pending'          then 'unconfirmed'
                  when 'confirmed'        then 'pending'
                  when 'out_for_delivery' then 'pending'
                  when 'delivered'        then 'paid'
                  else status               -- refused, cancelled stay
                end,
       paid_at       = case when status = 'delivered' then updated_at end,
       cancel_reason = case when status = 'cancelled' then 'No reason recorded (before upgrade)' end,
       city          = coalesce(city, delivery_area),
       details       = coalesce(details, delivery_address);

alter table public.orders
  alter column status set default 'unconfirmed',
  add constraint orders_status_check
    check (status in ('unconfirmed', 'pending', 'paid', 'cancelled', 'refused')),
  add constraint orders_cancel_reason_required
    check (status <> 'cancelled' or cancel_reason is not null);

-- ---------- Total rule, checked when the save finishes ----------
-- total = subtotal − discount + delivery fee + extra fees
create function private.check_order_total()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  o public.orders%rowtype;
begin
  select * into o from public.orders where id = new.id;
  if not found then
    return null;  -- deleted in the same transaction
  end if;
  if o.total <> o.subtotal - o.discount + o.delivery_fee + private.extra_fees_total(o.extra_fees) then
    raise exception 'Order total does not add up (total % ≠ subtotal % − discount % + delivery % + extra fees %)',
      o.total, o.subtotal, o.discount, o.delivery_fee, private.extra_fees_total(o.extra_fees)
      using errcode = '23514';
  end if;
  return null;
end;
$$;

-- (the trigger itself is created further down, after existing orders
--  have been converted — Postgres can't alter a table that has checks
--  waiting to run)

-- ---------- Display number: <prefix>-0001 ----------
create function private.set_display_number()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_prefix text;
begin
  if new.display_number is null then
    select ps.invoice_prefix into v_prefix
    from public.shop_private_settings ps
    where ps.shop_id = new.shop_id;
    new.display_number := coalesce(v_prefix, 'ORD') || '-'
      || lpad(new.order_number::text, greatest(4, length(new.order_number::text)), '0');
  end if;
  return new;
end;
$$;

-- (runs after orders_assign_number: triggers fire in name order)
create trigger orders_set_display_number
  before insert on public.orders
  for each row execute function private.set_display_number();

update public.orders o
   set display_number = coalesce(ps.invoice_prefix, 'ORD') || '-'
       || lpad(o.order_number::text, greatest(4, length(o.order_number::text)), '0')
  from public.shop_private_settings ps
 where ps.shop_id = o.shop_id and o.display_number is null;

alter table public.orders alter column display_number set not null;
create unique index orders_shop_display_number_key on public.orders (shop_id, display_number);

-- Total rule — checked when each save finishes (see check_order_total above).
create constraint trigger orders_check_total
  after insert or update on public.orders
  deferrable initially deferred
  for each row execute function private.check_order_total();

-- ---------- Status guard ----------
create function private.guard_order_status()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.source = 'website' and new.status <> 'unconfirmed' then
      raise exception 'New website orders must start as unconfirmed';
    end if;
    if new.source = 'manual' and new.status <> 'pending' then
      raise exception 'Manual invoices must start as pending';
    end if;
    return new;
  end if;

  if new.status is distinct from old.status then
    if not (
         (old.status = 'unconfirmed' and new.status in ('pending', 'cancelled'))
      or (old.status = 'pending'     and new.status in ('paid', 'cancelled', 'refused'))
      -- Step 12 only: edit_order() reopens a paid invoice (see top of file)
      or (old.status = 'paid' and new.status = 'pending'
          and coalesce(current_setting('app.reopen_paid_order', true), '') = 'on')
    ) then
      raise exception 'An order cannot go from % to %', old.status, new.status;
    end if;

    if new.status = 'paid' then
      new.paid_at := now();
    elsif old.status = 'paid' then
      new.paid_at := null;
    end if;
  end if;
  return new;
end;
$$;

create trigger orders_guard_status
  before insert or update of status on public.orders
  for each row execute function private.guard_order_status();


-- =====================================================================
-- 4. ORDER LINES
-- =====================================================================
-- (name_snapshot → name and price_snapshot → unit_price are renamed in
--  migration 3, together with the new place_order)
alter table public.order_items
  add column code          text check (char_length(code) <= 50),
  add column option_label  text check (char_length(option_label) <= 300),  -- "Flavor: Chocolate"
  add column list_price    numeric(10,2) check (list_price >= 0),          -- price before sale
  add column cost          numeric(10,2) check (cost >= 0),                -- wholesale cost snapshot
  add column photo         text check (char_length(photo) <= 500);

update public.order_items set list_price = price_snapshot where list_price is null;

-- Cost rule, part 1: copy the product's cost when a line is created.
create function private.fill_order_item_cost()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.cost is null and new.product_id is not null then
    select pc.wholesale_price into new.cost
    from public.product_costs pc
    where pc.product_id = new.product_id;
  end if;
  return new;
end;
$$;

create trigger order_items_fill_cost
  before insert on public.order_items
  for each row execute function private.fill_order_item_cost();

-- Cost rule, part 2: lines created while the product had no cost get it
-- the first time a cost is saved. Lines that already have a cost are
-- never changed (locked).
create function private.backfill_order_item_costs()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  update public.order_items oi
     set cost = new.wholesale_price
   where oi.product_id = new.product_id
     and oi.cost is null;
  return null;
end;
$$;

create trigger product_costs_backfill_order_items
  after insert or update of wholesale_price on public.product_costs
  for each row execute function private.backfill_order_item_costs();


-- =====================================================================
-- 5. ORDER HISTORY (written automatically)
-- =====================================================================
create table public.order_history (
  id             uuid primary key default gen_random_uuid(),
  at             timestamptz not null default now(),
  shop_id        uuid not null references public.shops (id) on delete cascade,
  order_id       uuid not null,
  text           text not null check (char_length(text) between 1 and 1000),
  actor_user_id  uuid,                              -- who did it (null = customer / system)
  actor_label    text not null check (char_length(actor_label) between 1 and 100),
  foreign key (order_id, shop_id) references public.orders (id, shop_id) on delete cascade
);
create index order_history_order_idx on public.order_history (order_id, at);

create function private.write_order_history()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid   uuid := (select auth.uid());
  v_text  text;
  v_label text;
begin
  if tg_op = 'INSERT' then
    v_text := case new.source when 'manual' then 'Invoice created' else 'Order placed on the website' end;
  elsif new.status is distinct from old.status then
    v_text := case new.status
      when 'pending'   then case when old.status = 'paid' then 'Reopened for editing' else 'Order confirmed' end
      when 'paid'      then 'Marked as paid'
      when 'cancelled' then 'Cancelled: ' || coalesce(new.cancel_reason, '')
      when 'refused'   then 'Marked as refused (customer refused the delivery)'
      else 'Status changed to ' || new.status
    end;
  else
    return null;
  end if;

  v_label := case
    when v_uid is not null then 'Shop'
    when tg_op = 'INSERT' and new.source = 'website' then 'Customer'
    else 'System'
  end;

  insert into public.order_history (shop_id, order_id, text, actor_user_id, actor_label)
  values (new.shop_id, new.id, v_text, v_uid, v_label);
  return null;
end;
$$;

create trigger orders_write_history
  after insert or update of status on public.orders
  for each row execute function private.write_order_history();


-- =====================================================================
-- 6. STOCK BACK ON CANCEL / REFUSE  +  REVIEW TOKEN ON PAID
-- =====================================================================
-- Secret per-order token for "review your purchase" links. Server-only:
-- no access at all for anon or authenticated.
create table public.order_review_tokens (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  shop_id     uuid not null references public.shops (id) on delete cascade,
  order_id    uuid not null unique,
  token       text not null unique default encode(extensions.gen_random_bytes(24), 'hex'),
  foreign key (order_id, shop_id) references public.orders (id, shop_id) on delete cascade
);

create function private.on_order_status_change()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.status is not distinct from old.status then
    return null;
  end if;

  -- Cancelled or refused: give the stock back (only where stock is tracked).
  if new.status in ('cancelled', 'refused') then
    update public.product_variants pv
       set stock = pv.stock + x.qty
      from (select oi.variant_id, sum(oi.quantity) as qty
            from public.order_items oi
            where oi.order_id = new.id and oi.variant_id is not null
            group by oi.variant_id) as x
     where pv.id = x.variant_id and pv.stock is not null;

    update public.products p
       set stock = p.stock + x.qty
      from (select oi.product_id, sum(oi.quantity) as qty
            from public.order_items oi
            where oi.order_id = new.id and oi.variant_id is null and oi.product_id is not null
            group by oi.product_id) as x
     where p.id = x.product_id and p.stock is not null;
  end if;

  -- Paid: create the secret review token (once).
  if new.status = 'paid' then
    insert into public.order_review_tokens (shop_id, order_id)
    values (new.shop_id, new.id)
    on conflict (order_id) do nothing;
  end if;

  return null;
end;
$$;

create trigger orders_on_status_change
  after update of status on public.orders
  for each row execute function private.on_order_status_change();


-- =====================================================================
-- 7. EMAIL STATUS on the order follows its notification rows
-- =====================================================================
create function private.sync_order_email_status()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.channel <> 'email' then
    return null;
  end if;
  update public.orders o
     set email_status = (
       select case
         when count(*) = 0 then 'none'
         when bool_or(n.status in ('pending', 'sending')) then 'pending'
         when bool_or(n.status = 'failed') then 'failed'
         else 'sent'
       end
       from public.notification_outbox n
       where n.order_id = new.order_id and n.channel = 'email'
     )
   where o.id = new.order_id;
  return null;
end;
$$;

create trigger notification_outbox_sync_email_status
  after insert or update of status on public.notification_outbox
  for each row execute function private.sync_order_email_status();

-- Existing orders: fill email_status from their notification rows.
update public.orders o
   set email_status = x.email_status
  from (
    select n.order_id,
           case
             when bool_or(n.status in ('pending', 'sending')) then 'pending'
             when bool_or(n.status = 'failed') then 'failed'
             else 'sent'
           end as email_status
    from public.notification_outbox n
    where n.channel = 'email'
    group by n.order_id
  ) as x
 where o.id = x.order_id;


-- =====================================================================
-- 8. BACK-OFFICE FUNCTIONS (shop members only; used in Step 11)
-- =====================================================================
-- Loads the order, locked, and checks the caller is a member of its shop.
create function private.member_order_for_update(p_order_id uuid)
returns public.orders
language plpgsql security definer set search_path = ''
as $$
declare
  o public.orders%rowtype;
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found or not private.is_shop_member(o.shop_id) then
    raise exception 'Order not found' using errcode = '42501';
  end if;
  return o;
end;
$$;

create function public.confirm_order(p_order_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  o public.orders%rowtype := private.member_order_for_update(p_order_id);
begin
  if o.status <> 'unconfirmed' then
    raise exception 'Only unconfirmed orders can be confirmed (this order is %)', o.status;
  end if;
  update public.orders set status = 'pending' where id = o.id;
  return jsonb_build_object('order_id', o.id, 'display_number', o.display_number, 'status', 'pending');
end;
$$;

create function public.mark_paid(p_order_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  o public.orders%rowtype := private.member_order_for_update(p_order_id);
begin
  if o.status <> 'pending' then
    raise exception 'Only pending orders can be marked as paid (this order is %)', o.status;
  end if;
  update public.orders set status = 'paid' where id = o.id;
  return jsonb_build_object('order_id', o.id, 'display_number', o.display_number, 'status', 'paid');
end;
$$;

create function public.cancel_order(p_order_id uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  o public.orders%rowtype := private.member_order_for_update(p_order_id);
begin
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Please give a reason for cancelling';
  end if;
  if char_length(trim(p_reason)) > 500 then
    raise exception 'The reason is too long (max 500 characters)';
  end if;
  if o.status not in ('unconfirmed', 'pending') then
    raise exception 'This order can no longer be cancelled (it is %)', o.status;
  end if;
  update public.orders
     set status = 'cancelled', cancel_reason = trim(p_reason)
   where id = o.id;
  return jsonb_build_object('order_id', o.id, 'display_number', o.display_number, 'status', 'cancelled');
end;
$$;

create function public.mark_refused(p_order_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  o public.orders%rowtype := private.member_order_for_update(p_order_id);
begin
  if o.status <> 'pending' then
    raise exception 'Only pending orders can be marked as refused (this order is %)', o.status;
  end if;
  update public.orders set status = 'refused' where id = o.id;
  return jsonb_build_object('order_id', o.id, 'display_number', o.display_number, 'status', 'refused');
end;
$$;


-- =====================================================================
-- 9. PRODUCT REVIEWS (real buyers only)
-- =====================================================================
create table public.product_reviews (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  shop_id        uuid not null references public.shops (id) on delete cascade,
  product_id     uuid not null,
  order_id       uuid not null,
  rating         smallint not null check (rating between 1 and 5),
  reviewer_name  text not null check (char_length(trim(reviewer_name)) between 1 and 60),
  text           text check (char_length(text) <= 1000),
  status         text not null default 'pending' check (status in ('pending', 'approved', 'hidden')),
  unique (order_id, product_id),          -- one review per product per order
  foreign key (product_id, shop_id) references public.products (id, shop_id) on delete cascade,
  foreign key (order_id, shop_id) references public.orders (id, shop_id) on delete cascade
);
create index product_reviews_product_idx on public.product_reviews (product_id, status, created_at desc);

-- What the PUBLIC may see: approved reviews of visible products in
-- active shops that have reviews turned on. No order_id, no phone.
create view public.product_reviews_public
with (security_barrier = true)
as
select r.id, r.created_at, r.shop_id, r.product_id, r.rating, r.reviewer_name, r.text
from public.product_reviews r
join public.products p on p.id = r.product_id
join public.shops s on s.id = r.shop_id
where r.status = 'approved'
  and p.is_active
  and s.is_active
  and s.reviews_on;

-- Server-only: the customer opens a private link containing the order's
-- review token (no login needed); our server calls this function.
create function public.submit_review(
  p_token          text,
  p_product_id     uuid,
  p_rating         integer,
  p_reviewer_name  text,
  p_text           text default null
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_order   public.orders%rowtype;
  v_shop    public.shops%rowtype;
  v_status  text;
  v_id      uuid;
begin
  select o.* into v_order
  from public.order_review_tokens t
  join public.orders o on o.id = t.order_id
  where t.token = p_token;
  if not found then
    raise exception 'This review link is not valid';
  end if;

  if v_order.status <> 'paid' then
    raise exception 'Reviews can only be left for paid orders';
  end if;

  select * into v_shop from public.shops where id = v_order.shop_id;
  if not v_shop.reviews_on or not v_shop.is_active then
    raise exception 'This shop is not accepting reviews';
  end if;

  if not exists (
    select 1 from public.order_items oi
    where oi.order_id = v_order.id and oi.product_id = p_product_id
  ) then
    raise exception 'This product was not part of your order';
  end if;

  if p_rating is null or p_rating not between 1 and 5 then
    raise exception 'Please choose a rating from 1 to 5 stars';
  end if;
  if coalesce(trim(p_reviewer_name), '') = '' or char_length(trim(p_reviewer_name)) > 60 then
    raise exception 'Please enter your name (max 60 characters)';
  end if;
  if char_length(coalesce(p_text, '')) > 1000 then
    raise exception 'Your review is too long (max 1000 characters)';
  end if;

  v_status := case when v_shop.reviews_need_approval then 'pending' else 'approved' end;

  begin
    insert into public.product_reviews (shop_id, product_id, order_id, rating, reviewer_name, text, status)
    values (v_order.shop_id, p_product_id, v_order.id, p_rating, trim(p_reviewer_name),
            nullif(trim(p_text), ''), v_status)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'You already reviewed this product';
  end;

  return jsonb_build_object('review_id', v_id, 'status', v_status);
end;
$$;


-- =====================================================================
-- 10. ROW LEVEL SECURITY
-- =====================================================================
alter table public.order_history        enable row level security;
alter table public.order_review_tokens  enable row level security;
alter table public.product_reviews      enable row level security;

create policy "Members can view their order history"
  on public.order_history for select to authenticated
  using (private.is_shop_member(shop_id));

-- order_review_tokens: no policies → nobody but the server.

create policy "Members can view their shop's reviews"
  on public.product_reviews for select to authenticated
  using (private.is_shop_member(shop_id));
create policy "Members can approve or hide their shop's reviews"
  on public.product_reviews for update to authenticated
  using (private.is_shop_member(shop_id))
  with check (private.is_shop_member(shop_id));


-- =====================================================================
-- 11. GRANTS
-- =====================================================================
revoke all on public.order_history, public.order_review_tokens, public.product_reviews
  from public, anon, authenticated;
revoke all on public.product_reviews_public from public, anon, authenticated;

revoke all on function private.is_valid_extra_fees(jsonb)       from public, anon, authenticated;
revoke all on function private.extra_fees_total(jsonb)          from public, anon, authenticated;
revoke all on function private.check_order_total()              from public, anon, authenticated;
revoke all on function private.set_display_number()             from public, anon, authenticated;
revoke all on function private.guard_order_status()             from public, anon, authenticated;
revoke all on function private.fill_order_item_cost()           from public, anon, authenticated;
revoke all on function private.backfill_order_item_costs()      from public, anon, authenticated;
revoke all on function private.write_order_history()            from public, anon, authenticated;
revoke all on function private.on_order_status_change()         from public, anon, authenticated;
revoke all on function private.sync_order_email_status()        from public, anon, authenticated;
revoke all on function private.member_order_for_update(uuid)    from public, anon, authenticated;
revoke all on function public.confirm_order(uuid)               from public, anon, authenticated;
revoke all on function public.mark_paid(uuid)                   from public, anon, authenticated;
revoke all on function public.cancel_order(uuid, text)          from public, anon, authenticated;
revoke all on function public.mark_refused(uuid)                from public, anon, authenticated;
revoke all on function public.submit_review(text, uuid, integer, text, text) from public, anon, authenticated;

-- Checks that run when members save orders (notes).
grant execute on function private.is_valid_extra_fees(jsonb) to authenticated, service_role;
grant execute on function private.extra_fees_total(jsonb)    to authenticated, service_role;

-- Orders / lines: members can only READ (and edit order notes).
-- Status changes: the functions below. Manual invoices & edits: Step 12.
revoke insert, update, delete on public.orders      from authenticated;
revoke insert, update, delete on public.order_items from authenticated;
grant update (notes) on public.orders to authenticated;

grant execute on function public.confirm_order(uuid)      to authenticated;
grant execute on function public.mark_paid(uuid)          to authenticated;
grant execute on function public.cancel_order(uuid, text) to authenticated;
grant execute on function public.mark_refused(uuid)       to authenticated;

grant select on public.order_history to authenticated;
grant select on public.product_reviews to authenticated;
grant update (status) on public.product_reviews to authenticated;
grant select on public.product_reviews_public to anon, authenticated;

-- service_role (trusted server code):
grant all on public.order_history, public.order_review_tokens, public.product_reviews
  to service_role;
grant select on public.product_reviews_public to service_role;
grant execute on function public.submit_review(text, uuid, integer, text, text) to service_role;
