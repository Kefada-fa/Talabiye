-- =====================================================================
-- Initial schema: shops, members, products, variants, customers,
-- orders, order items, delivery outcomes.
--
-- Security model
--   * Row Level Security (RLS) is ON for every table.
--   * Nothing is granted automatically ("auto-grant API access" is OFF),
--     so every permission each role gets is listed explicitly at the end.
--   * anon (not logged in): read active shops / products / variants,
--     and call place_order(). Nothing else.
--   * authenticated (logged in): only rows of shops they are a member of,
--     plus get_phone_risk().
--   * delivery_outcomes: no access for anon or authenticated, ever.
--
-- Run once, top to bottom, in the Supabase SQL Editor.
-- =====================================================================

-- pgcrypto gives us HMAC-SHA256 (phone hashing) and random tokens.
create extension if not exists pgcrypto with schema extensions;

-- "private" holds helper functions. It is NOT exposed through the API,
-- so nobody can call these functions directly from the website.
create schema if not exists private;
revoke all on schema private from public;


-- =====================================================================
-- 1. TABLES
-- =====================================================================

-- ---------- shops ----------------------------------------------------
create table public.shops (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  name            text not null check (char_length(name) between 1 and 100),
  -- Used in the URL: <domain>/<slug>. 3–40 chars, lowercase letters,
  -- digits and dashes, can't start/end with a dash.
  slug            text not null unique
                  check (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$')
                  -- Words reserved for our own pages, so no shop can take them.
                  check (slug not in (
                    'admin', 'api', 'app', 'auth', 'login', 'logout', 'signup',
                    'register', 'account', 'dashboard', 'settings', 'health',
                    'help', 'support', 'about', 'pricing', 'terms', 'privacy',
                    'contact', 'blog', 'www', 'static', 'assets', 'order', 'orders'
                  )),
  -- Lebanese number in +961 format, e.g. +96170123456 / +9613123456
  whatsapp_number text check (whatsapp_number ~ '^\+961[0-9]{7,8}$'),
  delivery_fee    numeric(10,2) not null default 0 check (delivery_fee >= 0),  -- USD
  logo_url        text,
  is_active       boolean not null default true,
  plan            text not null default 'free'
                  check (plan in ('free', 'starter', 'pro'))
);

-- ---------- shop_members ---------------------------------------------
create table public.shop_members (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  shop_id     uuid not null references public.shops (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  role        text not null default 'staff' check (role in ('owner', 'staff')),
  unique (shop_id, user_id)
);
create index shop_members_user_id_idx on public.shop_members (user_id);

-- ---------- products -------------------------------------------------
create table public.products (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  shop_id      uuid not null references public.shops (id) on delete cascade,
  name         text not null check (char_length(name) between 1 and 200),
  description  text check (char_length(description) <= 5000),
  price        numeric(10,2) not null check (price >= 0),  -- USD
  image_url    text,
  is_active    boolean not null default true,
  sort_order   integer not null default 0,
  -- Lets other tables check "this product belongs to the SAME shop".
  unique (id, shop_id)
);
create index products_shop_sort_idx on public.products (shop_id, sort_order);

-- ---------- product_variants -----------------------------------------
create table public.product_variants (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  shop_id         uuid not null references public.shops (id) on delete cascade,
  product_id      uuid not null,
  label           text not null check (char_length(label) between 1 and 100),  -- e.g. "Size 4Y"
  stock           integer not null default 0 check (stock >= 0),
  price_override  numeric(10,2) check (price_override >= 0),  -- null = use product price
  unique (id, shop_id),
  -- Variant must belong to a product of the same shop.
  foreign key (product_id, shop_id)
    references public.products (id, shop_id) on delete cascade
);
create index product_variants_product_id_idx on public.product_variants (product_id);

-- ---------- customers ------------------------------------------------
create table public.customers (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  shop_id     uuid not null references public.shops (id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 100),
  -- Always stored as +961XXXXXXX(X); a trigger below normalizes it.
  phone       text not null check (phone ~ '^\+961[0-9]{7,8}$'),
  area        text check (char_length(area) <= 100),
  address     text check (char_length(address) <= 500),
  notes       text check (char_length(notes) <= 2000),  -- shop's private notes
  unique (shop_id, phone),  -- one customer per phone number, per shop
  unique (id, shop_id)
);

-- ---------- orders ---------------------------------------------------
create table public.orders (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  shop_id         uuid not null references public.shops (id) on delete cascade,
  customer_id     uuid not null,
  order_number    integer not null,  -- 1, 2, 3… per shop (set by a trigger)
  status          text not null default 'pending'
                  check (status in ('pending', 'confirmed', 'out_for_delivery',
                                    'delivered', 'refused', 'cancelled')),
  subtotal        numeric(10,2) not null default 0 check (subtotal >= 0),
  delivery_fee    numeric(10,2) not null default 0 check (delivery_fee >= 0),
  total           numeric(10,2) not null default 0 check (total >= 0),
  deposit_amount  numeric(10,2) not null default 0 check (deposit_amount >= 0),
  deposit_status  text not null default 'none'
                  check (deposit_status in ('none', 'requested', 'paid')),
  payment_method  text not null default 'cod'
                  check (payment_method in ('cod', 'whish')),
  notes           text check (char_length(notes) <= 2000),
  -- Random, unguessable token for a "confirm your order" link.
  confirm_token   text not null unique
                  default encode(extensions.gen_random_bytes(16), 'hex'),
  unique (shop_id, order_number),
  unique (id, shop_id),
  -- Customer must belong to the same shop.
  foreign key (customer_id, shop_id) references public.customers (id, shop_id)
);
create index orders_shop_created_idx on public.orders (shop_id, created_at desc);
create index orders_customer_id_idx on public.orders (customer_id);

-- ---------- order_items ----------------------------------------------
create table public.order_items (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  shop_id         uuid not null references public.shops (id) on delete cascade,
  order_id        uuid not null,
  product_id      uuid,  -- becomes null if the product is deleted later
  variant_id      uuid,  -- becomes null if the variant is deleted later
  -- Snapshots: what the customer saw when ordering, even if the
  -- product's name or price changes later.
  name_snapshot   text not null check (char_length(name_snapshot) between 1 and 300),
  price_snapshot  numeric(10,2) not null check (price_snapshot >= 0),
  quantity        integer not null check (quantity between 1 and 1000),
  foreign key (order_id, shop_id)
    references public.orders (id, shop_id) on delete cascade,
  foreign key (product_id, shop_id)
    references public.products (id, shop_id) on delete set null (product_id),
  foreign key (variant_id, shop_id)
    references public.product_variants (id, shop_id) on delete set null (variant_id)
);
create index order_items_order_id_idx on public.order_items (order_id);

-- ---------- delivery_outcomes ----------------------------------------
-- Cross-shop record of "did this phone number accept or refuse delivery".
-- Stores only an HMAC-SHA256 hash of the phone (keyed with a secret salt),
-- never the phone itself. Filled automatically by a trigger on orders.
create table public.delivery_outcomes (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  phone_hash  text not null,
  shop_id     uuid not null references public.shops (id) on delete cascade,
  order_id    uuid not null unique,
  outcome     text not null check (outcome in ('delivered', 'refused')),
  foreign key (order_id, shop_id)
    references public.orders (id, shop_id) on delete cascade
);
create index delivery_outcomes_phone_hash_idx on public.delivery_outcomes (phone_hash);


-- =====================================================================
-- 2. SECRET SALT for phone hashing (stored in Supabase Vault)
-- =====================================================================
-- Generated randomly inside your database, so it never appears in code
-- or git. Never delete or change it: old hashes would stop matching.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'phone_hash_salt') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'phone_hash_salt',
      'Secret salt for delivery_outcomes.phone_hash. Never change or delete.'
    );
  end if;
end;
$$;


-- =====================================================================
-- 3. HELPER FUNCTIONS (private schema)
-- =====================================================================

-- Is the logged-in user a member (owner or staff) of this shop?
-- "security definer" lets it read shop_members without RLS getting in
-- the way (avoids policies checking themselves forever).
create function private.is_shop_member(p_shop_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.shop_members m
    where m.shop_id = p_shop_id
      and m.user_id = (select auth.uid())
  );
$$;

-- Is the logged-in user an OWNER of this shop?
create function private.is_shop_owner(p_shop_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.shop_members m
    where m.shop_id = p_shop_id
      and m.user_id = (select auth.uid())
      and m.role = 'owner'
  );
$$;

-- Turns any common way of writing a Lebanese number into +961XXXXXXX(X).
--   "03 123 456" → +9613123456      "70-123-456"    → +96170123456
--   "+961 70 123456" → +96170123456 "00961 3 123456" → +9613123456
--   "+961 03 123456" → +9613123456  (extra 0 after country code removed)
create function private.normalize_lb_phone(p_phone text)
returns text
language plpgsql immutable set search_path = ''
as $$
declare
  d text;
begin
  if p_phone is null then
    return null;
  end if;

  d := regexp_replace(p_phone, '[^0-9]', '', 'g');  -- keep digits only

  if d like '00961%' then
    d := substr(d, 3);                 -- 00961… → 961…
  elsif d like '961%' and length(d) >= 10 then
    null;                              -- already has country code
  elsif d like '0%' then
    d := '961' || substr(d, 2);        -- 03… → 9613…
  else
    d := '961' || d;                   -- 70… → 96170…
  end if;

  if d like '9610%' then
    d := '961' || substr(d, 5);        -- 96103… → 9613…
  end if;

  if d !~ '^961[0-9]{7,8}$' then
    raise exception 'Invalid Lebanese phone number: %', p_phone
      using errcode = '22023';
  end if;

  return '+' || d;
end;
$$;

-- HMAC-SHA256 of the normalized phone, keyed with the Vault salt.
create function private.phone_hash(p_phone text)
returns text
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_salt text;
begin
  select s.decrypted_secret into v_salt
  from vault.decrypted_secrets s
  where s.name = 'phone_hash_salt';

  if v_salt is null then
    raise exception 'phone_hash_salt secret is missing from Vault';
  end if;

  return encode(
    extensions.hmac(private.normalize_lb_phone(p_phone), v_salt, 'sha256'),
    'hex'
  );
end;
$$;


-- =====================================================================
-- 4. TRIGGERS (run automatically when rows change)
-- =====================================================================

-- Keep orders.updated_at current.
create function private.set_updated_at()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function private.set_updated_at();

-- Normalize customer phone numbers on every insert/update.
create function private.normalize_customer_phone()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  new.phone := private.normalize_lb_phone(new.phone);
  return new;
end;
$$;

create trigger customers_normalize_phone
  before insert or update of phone on public.customers
  for each row execute function private.normalize_customer_phone();

-- Give each new order the next number for its shop (1, 2, 3…).
-- A per-shop lock makes sure two orders at the same moment can't
-- get the same number.
create function private.assign_order_number()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('order_number:' || new.shop_id::text, 0));

  select coalesce(max(o.order_number), 0) + 1
    into new.order_number
  from public.orders o
  where o.shop_id = new.shop_id;

  return new;
end;
$$;

create trigger orders_assign_number
  before insert on public.orders
  for each row execute function private.assign_order_number();

-- When an order becomes delivered/refused, record the outcome (hashed
-- phone only). If the status changes to anything else, remove it.
create function private.record_delivery_outcome()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_phone text;
begin
  if new.status in ('delivered', 'refused') then
    select c.phone into v_phone
    from public.customers c
    where c.id = new.customer_id;

    insert into public.delivery_outcomes (phone_hash, shop_id, order_id, outcome)
    values (private.phone_hash(v_phone), new.shop_id, new.id, new.status)
    on conflict (order_id)
      do update set outcome = excluded.outcome, phone_hash = excluded.phone_hash;
  else
    delete from public.delivery_outcomes d where d.order_id = new.id;
  end if;

  return new;
end;
$$;

create trigger orders_record_delivery_outcome
  after insert or update of status on public.orders
  for each row execute function private.record_delivery_outcome();


-- =====================================================================
-- 5. PUBLIC FUNCTIONS (callable from the website)
-- =====================================================================

-- place_order: the ONLY way the public can create an order.
-- The browser sends only product/variant IDs and quantities; prices,
-- totals, delivery fee and stock are all decided here in the database.
--
-- p_items example:
--   [{"product_id": "…", "variant_id": "…", "quantity": 2}]
--   (variant_id is required when the product has variants; omit or
--    null when it has none)
--
-- Returns: {order_id, order_number, subtotal, delivery_fee, total, confirm_token}
create function public.place_order(
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
  v_shop          public.shops%rowtype;
  v_phone         text;
  v_customer_id   uuid;
  v_order_id      uuid;
  v_order_number  integer;
  v_confirm_token text;
  v_subtotal      numeric(10,2) := 0;
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
  if jsonb_array_length(p_items) > 50 then
    raise exception 'Too many items in one order';
  end if;

  -- ---- 2. Create / update the customer (one per phone per shop) -----
  insert into public.customers (shop_id, name, phone, area, address)
  values (v_shop.id, trim(p_customer_name), v_phone,
          nullif(trim(p_customer_area), ''), trim(p_customer_address))
  on conflict (shop_id, phone) do update
    set name    = excluded.name,
        area    = coalesce(excluded.area, public.customers.area),
        address = excluded.address
  returning id into v_customer_id;

  -- ---- 3. Create the order (totals filled in at the end) ------------
  insert into public.orders (shop_id, customer_id, delivery_fee, payment_method, notes)
  values (v_shop.id, v_customer_id, v_shop.delivery_fee, p_payment_method,
          nullif(trim(p_notes), ''))
  returning id, order_number, confirm_token
    into v_order_id, v_order_number, v_confirm_token;

  -- ---- 4. Add each item, using REAL prices and checking stock -------
  -- Same product+variant listed twice is merged into one line.
  -- Sorted so concurrent orders lock rows in the same order.
  for v_item in
    select (e ->> 'product_id')::uuid               as product_id,
           nullif(e ->> 'variant_id', '')::uuid      as variant_id,
           sum((e ->> 'quantity')::integer)          as quantity
    from jsonb_array_elements(p_items) as e
    group by 1, 2
    order by 1, 2
  loop
    if v_item.product_id is null then
      raise exception 'Invalid item in cart';
    end if;
    if v_item.quantity is null or v_item.quantity < 1 or v_item.quantity > 100 then
      raise exception 'Invalid quantity';
    end if;

    select * into v_product
    from public.products p
    where p.id = v_item.product_id
      and p.shop_id = v_shop.id
      and p.is_active;
    if not found then
      raise exception 'A product in your cart is no longer available';
    end if;

    if exists (select 1 from public.product_variants pv where pv.product_id = v_product.id) then
      -- Product has variants (e.g. sizes): one must be chosen; stock is tracked.
      if v_item.variant_id is null then
        raise exception 'Please choose an option for %', v_product.name;
      end if;

      select * into v_variant
      from public.product_variants pv
      where pv.id = v_item.variant_id
        and pv.product_id = v_product.id
      for update;  -- lock this row so two buyers can't take the last one
      if not found then
        raise exception 'An option in your cart is no longer available';
      end if;

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

      v_variant_id := v_variant.id;
      v_price      := coalesce(v_variant.price_override, v_product.price);
      v_name       := v_product.name || ' — ' || v_variant.label;
    else
      -- Product without variants: no stock tracking.
      if v_item.variant_id is not null then
        raise exception 'An option in your cart is no longer available';
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
  end loop;

  -- ---- 5. Save totals -------------------------------------------------
  update public.orders o
    set subtotal = v_subtotal,
        total    = v_subtotal + o.delivery_fee
  where o.id = v_order_id;

  return jsonb_build_object(
    'order_id',      v_order_id,
    'order_number',  v_order_number,
    'subtotal',      v_subtotal,
    'delivery_fee',  v_shop.delivery_fee,
    'total',         v_subtotal + v_shop.delivery_fee,
    'confirm_token', v_confirm_token
  );
end;
$$;

-- get_phone_risk: how many past orders to this phone number were
-- delivered vs refused, across ALL shops. Counts only — never which
-- shops or orders. Only logged-in shop members may call it.
create function public.get_phone_risk(p_phone text)
returns table (delivered integer, refused integer)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_hash text;
begin
  if (select auth.uid()) is null
     or not exists (
       select 1 from public.shop_members m
       where m.user_id = (select auth.uid())
     ) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  v_hash := private.phone_hash(p_phone);

  return query
    select (count(*) filter (where d.outcome = 'delivered'))::integer,
           (count(*) filter (where d.outcome = 'refused'))::integer
    from public.delivery_outcomes d
    where d.phone_hash = v_hash;
end;
$$;


-- =====================================================================
-- 6. ROW LEVEL SECURITY (which ROWS each user can see/change)
-- =====================================================================
alter table public.shops             enable row level security;
alter table public.shop_members      enable row level security;
alter table public.products          enable row level security;
alter table public.product_variants  enable row level security;
alter table public.customers         enable row level security;
alter table public.orders            enable row level security;
alter table public.order_items       enable row level security;
alter table public.delivery_outcomes enable row level security;
-- delivery_outcomes intentionally has NO policies → no rows for anyone
-- (only the security-definer functions above can touch it).

-- ---------- shops ----------
create policy "Public can view active shops"
  on public.shops for select to anon, authenticated
  using (is_active);

create policy "Members can view their shops"
  on public.shops for select to authenticated
  using (private.is_shop_member(id));

create policy "Owners can update their shops"
  on public.shops for update to authenticated
  using (private.is_shop_owner(id))
  with check (private.is_shop_owner(id));

-- ---------- shop_members ----------
create policy "Members can view their shop's team"
  on public.shop_members for select to authenticated
  using (private.is_shop_member(shop_id));

create policy "Owners can add team members"
  on public.shop_members for insert to authenticated
  with check (private.is_shop_owner(shop_id));

create policy "Owners can change team members"
  on public.shop_members for update to authenticated
  using (private.is_shop_owner(shop_id))
  with check (private.is_shop_owner(shop_id));

create policy "Owners can remove team members"
  on public.shop_members for delete to authenticated
  using (private.is_shop_owner(shop_id));

-- ---------- products ----------
create policy "Public can view active products of active shops"
  on public.products for select to anon, authenticated
  using (
    is_active
    and exists (select 1 from public.shops s where s.id = shop_id and s.is_active)
  );

create policy "Members can manage their products"
  on public.products for all to authenticated
  using (private.is_shop_member(shop_id))
  with check (private.is_shop_member(shop_id));

-- ---------- product_variants ----------
create policy "Public can view variants of active products"
  on public.product_variants for select to anon, authenticated
  using (
    exists (
      select 1
      from public.products p
      join public.shops s on s.id = p.shop_id
      where p.id = product_id and p.is_active and s.is_active
    )
  );

create policy "Members can manage their variants"
  on public.product_variants for all to authenticated
  using (private.is_shop_member(shop_id))
  with check (private.is_shop_member(shop_id));

-- ---------- customers / orders / order_items (members only) ----------
create policy "Members can manage their customers"
  on public.customers for all to authenticated
  using (private.is_shop_member(shop_id))
  with check (private.is_shop_member(shop_id));

create policy "Members can manage their orders"
  on public.orders for all to authenticated
  using (private.is_shop_member(shop_id))
  with check (private.is_shop_member(shop_id));

create policy "Members can manage their order items"
  on public.order_items for all to authenticated
  using (private.is_shop_member(shop_id))
  with check (private.is_shop_member(shop_id));


-- =====================================================================
-- 7. GRANTS (which TABLES / FUNCTIONS each role may use at all)
-- RLS above then limits which ROWS. Both must allow an action.
-- =====================================================================

-- Start from zero, in case anything was granted by default.
revoke all on public.shops, public.shop_members, public.products,
              public.product_variants, public.customers, public.orders,
              public.order_items, public.delivery_outcomes
  from public, anon, authenticated;

-- Postgres lets EVERYONE run new functions by default — undo that.
revoke all on function private.is_shop_member(uuid)          from public, anon, authenticated;
revoke all on function private.is_shop_owner(uuid)           from public, anon, authenticated;
revoke all on function private.normalize_lb_phone(text)      from public, anon, authenticated;
revoke all on function private.phone_hash(text)              from public, anon, authenticated;
revoke all on function private.set_updated_at()              from public, anon, authenticated;
revoke all on function private.normalize_customer_phone()    from public, anon, authenticated;
revoke all on function private.assign_order_number()         from public, anon, authenticated;
revoke all on function private.record_delivery_outcome()     from public, anon, authenticated;
revoke all on function public.place_order(text, text, text, text, text, jsonb, text, text)
  from public, anon, authenticated;
revoke all on function public.get_phone_risk(text)           from public, anon, authenticated;

grant usage on schema public to anon, authenticated;

-- ---------- anon (visitors, not logged in) ----------
grant select on public.shops, public.products, public.product_variants to anon;
grant execute on function public.place_order(text, text, text, text, text, jsonb, text, text) to anon;

-- ---------- authenticated (logged-in shop members) ----------
-- RLS policies call these two helpers, so members need to be able to run them.
grant usage on schema private to authenticated;
grant execute on function private.is_shop_member(uuid) to authenticated;
grant execute on function private.is_shop_owner(uuid)  to authenticated;

-- shops: view, and edit settings — but NOT "plan" (billing) or "id".
-- New shops will be created through a sign-up function in a later step.
grant select on public.shops to authenticated;
grant update (name, slug, whatsapp_number, delivery_fee, logo_url, is_active)
  on public.shops to authenticated;

grant select, insert, update, delete on public.shop_members     to authenticated;
grant select, insert, update, delete on public.products         to authenticated;
grant select, insert, update, delete on public.product_variants to authenticated;
grant select, insert, update, delete on public.customers        to authenticated;
grant select, insert, update, delete on public.order_items      to authenticated;

-- orders: no delete (cancel instead). order_number / confirm_token are
-- set by the database and can't be changed by users.
grant select on public.orders to authenticated;
grant insert (shop_id, customer_id, status, subtotal, delivery_fee, total,
              deposit_amount, deposit_status, payment_method, notes)
  on public.orders to authenticated;
grant update (customer_id, status, subtotal, delivery_fee, total,
              deposit_amount, deposit_status, payment_method, notes)
  on public.orders to authenticated;

grant execute on function public.place_order(text, text, text, text, text, jsonb, text, text) to authenticated;
grant execute on function public.get_phone_risk(text) to authenticated;

-- ---------- service_role (trusted server code only, never the browser) ----------
grant all on public.shops, public.shop_members, public.products,
             public.product_variants, public.customers, public.orders,
             public.order_items, public.delivery_outcomes
  to service_role;

-- Nothing at all is granted on public.delivery_outcomes to anon or authenticated.
