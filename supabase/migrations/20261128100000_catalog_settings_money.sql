-- =====================================================================
-- Step 6 — Migration 1 of 3: catalog, shop settings, costs, money.
-- Run once, after 20261127140000_notifications_and_receipt.sql.
--
-- Product-neutral: works for ANY product (clothes, toys, supplements,
-- cosmetics, food, electronics…). Never assumes "Size".
--
-- Adds:
--   1. Lebanese mobile numbers only (normalize_lb_phone)
--   2. lebanon_governorates / lebanon_districts (public lists)
--   3. Shop PUBLIC settings (columns on shops) + shop_delivery_fees
--   4. shop_private_settings (members only): initial_investment, invoice_prefix
--   5. Product fields: code, collection, categories, sale_price, brand,
--      expiry_date, barcode, weight
--   6. Options: up to 2 option types per product, ordered values,
--      stock + optional price per combination (product_variants).
--      Existing products/variants are moved over automatically.
--   7. product_photos (public only for visible products)
--   8. product_costs (members only — never public)
--   9. money_entries (members only)
-- =====================================================================


-- =====================================================================
-- 1. PHONE NUMBERS: Lebanese MOBILE numbers only
-- =====================================================================
-- Accepted (with or without 961 / +961 / 00961, spaces, dashes or a
-- leading 0):
--   * 8 digits starting with 70, 71, 76, 78, 79, 81   e.g. 70 123 456
--   * 7 digits starting with 3 (the "03" numbers)      e.g. 03 123 456
-- Stored as +961XXXXXXX(X). Landlines (01, 04, 05, 06, 07, 08, 09) and
-- anything else are refused.
create or replace function private.normalize_lb_phone(p_phone text)
returns text
language plpgsql immutable set search_path = ''
as $$
declare
  d text;
begin
  if p_phone is null then
    return null;
  end if;

  d := regexp_replace(p_phone, '[^0-9]', '', 'g');  -- digits only

  if d like '00961%' then
    d := substr(d, 6);
  elsif d like '961%' and length(d) >= 10 then
    d := substr(d, 4);
  end if;

  if d like '0%' then
    d := substr(d, 2);                 -- 03… → 3…, 070… → 70…
  end if;

  if d !~ '^(3[0-9]{6}|(70|71|76|78|79|81)[0-9]{6})$' then
    raise exception 'Please type a valid Lebanese mobile number, for example 03 123 456 or 70 123 456.'
      using errcode = '22023';
  end if;

  return '+961' || d;
end;
$$;


-- =====================================================================
-- 2. LEBANON LOCATIONS (public, read-only lists)
-- =====================================================================
create table public.lebanon_governorates (
  name        text primary key,
  sort_order  integer not null
);

create table public.lebanon_districts (
  governorate text not null references public.lebanon_governorates (name) on update cascade,
  name        text not null,
  sort_order  integer not null,
  primary key (governorate, name)
);

insert into public.lebanon_governorates (name, sort_order) values
  ('Akkar', 1), ('Baalbek-Hermel', 2), ('Beirut', 3), ('Beqaa', 4),
  ('Keserwan-Jbeil', 5), ('Mount Lebanon', 6), ('Nabatieh', 7),
  ('North', 8), ('South', 9);

insert into public.lebanon_districts (governorate, name, sort_order) values
  ('Akkar',          'Akkar',           1),
  ('Baalbek-Hermel', 'Baalbek',         1),
  ('Baalbek-Hermel', 'Hermel',          2),
  ('Beirut',         'Beirut',          1),
  ('Beqaa',          'Rashaya',         1),
  ('Beqaa',          'West Beqaa',      2),
  ('Beqaa',          'Zahle',           3),
  ('Keserwan-Jbeil', 'Jbeil',           1),
  ('Keserwan-Jbeil', 'Keserwan',        2),
  ('Mount Lebanon',  'Aley',            1),
  ('Mount Lebanon',  'Baabda',          2),
  ('Mount Lebanon',  'Chouf',           3),
  ('Mount Lebanon',  'Matn',            4),
  ('Nabatieh',       'Bint Jbeil',      1),
  ('Nabatieh',       'Hasbaya',         2),
  ('Nabatieh',       'Marjayoun',       3),
  ('Nabatieh',       'Nabatieh',        4),
  ('North',          'Batroun',         1),
  ('North',          'Bsharri',         2),
  ('North',          'Koura',           3),
  ('North',          'Minieh-Danniyeh', 4),
  ('North',          'Tripoli',         5),
  ('North',          'Zgharta',         6),
  ('South',          'Jezzine',         1),
  ('South',          'Sidon',           2),
  ('South',          'Tyre',            3);


-- =====================================================================
-- 3. SHOP PUBLIC SETTINGS (anyone can read them for active shops)
-- =====================================================================
-- Note: the existing shops.delivery_fee becomes the fixed delivery fee
-- (renamed to delivery_fixed in migration 3, together with place_order).
alter table public.shops
  add column delivery_on           boolean not null default true,
  add column delivery_mode         text    not null default 'fixed'
                                   check (delivery_mode in ('fixed', 'governorate')),
  add column free_delivery_on      boolean not null default false,
  add column free_delivery_above   numeric(10,2) check (free_delivery_above > 0),
  add column delivery_note         text check (char_length(delivery_note) <= 500),
  add column description_on        boolean not null default true,  -- show product descriptions
  add column policy_on             boolean not null default true,  -- ask customers to accept the policy
  add column policy_text           text check (char_length(policy_text) <= 2000),
  add column low_stock_at          integer not null default 3 check (low_stock_at between 0 and 1000),
  add column instagram             text check (char_length(instagram) <= 200),
  add column facebook              text check (char_length(facebook) <= 200),
  add column primary_color         text check (primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  add column accent_color          text check (accent_color ~ '^#[0-9A-Fa-f]{6}$'),
  add column hero_text             text check (char_length(hero_text) <= 300),
  add column reviews_on            boolean not null default false,
  add column reviews_need_approval boolean not null default true,
  add constraint shops_free_delivery_needs_amount
    check (not free_delivery_on or free_delivery_above is not null);

-- Delivery fee per governorate (used when delivery_mode = 'governorate').
-- No row, or fee = null  →  "no delivery to this governorate".
create table public.shop_delivery_fees (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  shop_id      uuid not null references public.shops (id) on delete cascade,
  governorate  text not null references public.lebanon_governorates (name) on update cascade,
  fee          numeric(10,2) check (fee >= 0),
  unique (shop_id, governorate)
);


-- =====================================================================
-- 4. SHOP PRIVATE SETTINGS (members only)
-- =====================================================================
create table public.shop_private_settings (
  id                  uuid primary key default gen_random_uuid(),
  created_at          timestamptz not null default now(),
  shop_id             uuid not null unique references public.shops (id) on delete cascade,
  initial_investment  numeric(12,2) check (initial_investment >= 0),
  -- Invoice numbers look like <prefix>-0001, e.g. KF-0001.
  invoice_prefix      text not null default 'ORD' check (invoice_prefix ~ '^[A-Z0-9]{1,6}$')
);

create function private.create_shop_private_settings()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.shop_private_settings (shop_id)
  values (new.id)
  on conflict (shop_id) do nothing;
  return new;
end;
$$;

create trigger shops_create_private_settings
  after insert on public.shops
  for each row execute function private.create_shop_private_settings();

insert into public.shop_private_settings (shop_id)
select s.id from public.shops s
on conflict (shop_id) do nothing;


-- =====================================================================
-- 5. PRODUCT FIELDS (all optional)
-- =====================================================================
-- A list of short labels (categories): max 20, each 1–50 characters.
create function private.is_valid_label_list(p_labels text[])
returns boolean
language sql immutable set search_path = ''
as $$
  select coalesce(cardinality(p_labels), 0) <= 20
     and coalesce(bool_and(l is not null and char_length(trim(l)) between 1 and 50), true)
  from unnest(p_labels) as l;
$$;

alter table public.products
  add column code        text check (code ~ '^[A-Za-z0-9._-]{1,50}$'),
  add column collection  text check (char_length(trim(collection)) between 1 and 100),
  add column categories  text[] not null default '{}' check (private.is_valid_label_list(categories)),
  add column sale_price  numeric(10,2),
  add column brand       text check (char_length(trim(brand)) between 1 and 100),
  add column expiry_date date,
  add column barcode     text check (barcode ~ '^[A-Za-z0-9-]{1,64}$'),
  add column weight      text check (char_length(trim(weight)) between 1 and 50),  -- e.g. "1 kg", "250 ml"
  add constraint products_sale_price_check
    check (sale_price is null or (sale_price > 0 and sale_price < price));

-- Item codes are unique within a shop (not case-sensitive).
create unique index products_shop_code_key on public.products (shop_id, lower(code)) where code is not null;
-- Storefront shows newest products first.
create index products_shop_newest_idx on public.products (shop_id, created_at desc);


-- =====================================================================
-- 6. OPTIONS: up to 2 option types per product
-- =====================================================================
--   product_option_types   — "Size", "Flavor", "Color"… (position 1 or 2)
--   product_option_values  — "4Y", "Chocolate", "Red"… (ordered)
--   product_variants       — one row per COMBINATION (value1 [+ value2]),
--                            with its own stock and optional own price.
-- Products with no options keep their single products.stock.
create table public.product_option_types (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  shop_id     uuid not null references public.shops (id) on delete cascade,
  product_id  uuid not null,
  position    smallint not null check (position in (1, 2)),
  name        text not null check (char_length(trim(name)) between 1 and 50),
  unique (product_id, position),
  unique (id, product_id),
  foreign key (product_id, shop_id) references public.products (id, shop_id) on delete cascade
);

create table public.product_option_values (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  shop_id         uuid not null references public.shops (id) on delete cascade,
  product_id      uuid not null,
  option_type_id  uuid not null,
  value           text not null check (char_length(trim(value)) between 1 and 100),
  position        integer not null default 0,
  unique (option_type_id, value),
  unique (id, product_id),
  foreign key (option_type_id, product_id)
    references public.product_option_types (id, product_id) on delete cascade,
  foreign key (product_id, shop_id) references public.products (id, shop_id) on delete cascade
);
create index product_option_values_type_idx on public.product_option_values (option_type_id, position);

alter table public.product_variants
  add column value1_id uuid,
  add column value2_id uuid,
  add constraint product_variants_value1_fk foreign key (value1_id, product_id)
    references public.product_option_values (id, product_id) on delete cascade,
  add constraint product_variants_value2_fk foreign key (value2_id, product_id)
    references public.product_option_values (id, product_id) on delete cascade,
  add constraint product_variants_value2_needs_value1
    check (value2_id is null or value1_id is not null);

create unique index product_variants_combination_key
  on public.product_variants (product_id, value1_id, value2_id) nulls not distinct
  where value1_id is not null;

-- ---------- Move existing data to the new model ----------
-- Each product that has variants gets option type #1 named after its old
-- option_label ("Size", "Flavor"…); each variant label becomes a value.
insert into public.product_option_types (shop_id, product_id, position, name)
select p.shop_id, p.id, 1, coalesce(nullif(trim(p.option_label), ''), 'Option')
from public.products p
where exists (select 1 from public.product_variants v where v.product_id = p.id);

insert into public.product_option_values (shop_id, product_id, option_type_id, value, position)
select distinct on (t.id, v.label) v.shop_id, v.product_id, t.id, v.label, v.sort_order
from public.product_variants v
join public.product_option_types t on t.product_id = v.product_id and t.position = 1
order by t.id, v.label, v.sort_order;

update public.product_variants v
   set value1_id = ov.id
  from public.product_option_values ov
  join public.product_option_types t on t.id = ov.option_type_id and t.position = 1
 where ov.product_id = v.product_id and ov.value = v.label;

-- ---------- Keep the old summary columns in sync ----------
-- products.option_label = type names ("Size" or "Color / Size")
-- product_variants.label = value(s)  ("4Y" or "Red / M")
-- (older code still reads them; new code reads the option tables)
create function private.sync_product_option_label(p_product_id uuid)
returns void
language sql security definer set search_path = ''
as $$
  update public.products p
     set option_label = (
       select string_agg(t.name, ' / ' order by t.position)
       from public.product_option_types t
       where t.product_id = p_product_id
     )
   where p.id = p_product_id;
$$;

create function private.on_option_type_change()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.sync_product_option_label(coalesce(new.product_id, old.product_id));
  return null;
end;
$$;

create trigger product_option_types_sync_label
  after insert or update or delete on public.product_option_types
  for each row execute function private.on_option_type_change();

-- Variant checks + label: value1 must be of type #1, value2 of type #2.
create function private.prepare_variant()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_pos1 smallint;
  v_pos2 smallint;
  v_label1 text;
  v_label2 text;
begin
  if new.value1_id is not null then
    select t.position, ov.value into v_pos1, v_label1
    from public.product_option_values ov
    join public.product_option_types t on t.id = ov.option_type_id
    where ov.id = new.value1_id;
    if v_pos1 is distinct from 1 then
      raise exception 'The first option value must belong to the first option type';
    end if;
  end if;

  if new.value2_id is not null then
    select t.position, ov.value into v_pos2, v_label2
    from public.product_option_values ov
    join public.product_option_types t on t.id = ov.option_type_id
    where ov.id = new.value2_id;
    if v_pos2 is distinct from 2 then
      raise exception 'The second option value must belong to the second option type';
    end if;
  end if;

  if new.value1_id is not null then
    new.label := v_label1 || coalesce(' / ' || v_label2, '');
  end if;
  return new;
end;
$$;

create trigger product_variants_prepare
  before insert or update of value1_id, value2_id on public.product_variants
  for each row execute function private.prepare_variant();

-- Renaming an option value updates the labels of its combinations.
create function private.on_option_value_rename()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  update public.product_variants v
     set value1_id = v.value1_id   -- re-runs prepare_variant → new label
   where v.value1_id = new.id or v.value2_id = new.id;
  return null;
end;
$$;

create trigger product_option_values_rename
  after update of value on public.product_option_values
  for each row execute function private.on_option_value_rename();


-- =====================================================================
-- 7. PRODUCT PHOTOS
-- =====================================================================
-- storage_path: where the photo is stored (Supabase Storage, set up in a
-- later step), or a full https:// address.
create table public.product_photos (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  shop_id       uuid not null references public.shops (id) on delete cascade,
  product_id    uuid not null,
  storage_path  text not null check (char_length(storage_path) between 1 and 500 and storage_path !~ '\.\.'),
  position      integer not null default 0,
  foreign key (product_id, shop_id) references public.products (id, shop_id) on delete cascade
);
create index product_photos_product_idx on public.product_photos (product_id, position);


-- =====================================================================
-- 8. PRODUCT COSTS (private — members of the shop only)
-- =====================================================================
create table public.product_costs (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  shop_id          uuid not null references public.shops (id) on delete cascade,
  product_id       uuid not null unique,
  wholesale_price  numeric(10,2) not null check (wholesale_price >= 0),
  foreign key (product_id, shop_id) references public.products (id, shop_id) on delete cascade
);


-- =====================================================================
-- 9. MONEY (members only)
-- =====================================================================
create table public.money_entries (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  shop_id     uuid not null references public.shops (id) on delete cascade,
  kind        text not null check (kind in ('stock_purchase', 'expense', 'money_added', 'money_withdrawn')),
  entry_date  date not null default current_date,
  name        text not null check (char_length(trim(name)) between 1 and 200),
  amount      numeric(12,2) not null check (amount > 0),
  notes       text check (char_length(notes) <= 2000),
  file_path   text check (char_length(file_path) <= 500)  -- receipt photo, private storage later
);
create index money_entries_shop_date_idx on public.money_entries (shop_id, entry_date desc);


-- =====================================================================
-- 10. ROW LEVEL SECURITY
-- =====================================================================
alter table public.lebanon_governorates   enable row level security;
alter table public.lebanon_districts      enable row level security;
alter table public.shop_delivery_fees     enable row level security;
alter table public.shop_private_settings  enable row level security;
alter table public.product_option_types   enable row level security;
alter table public.product_option_values  enable row level security;
alter table public.product_photos         enable row level security;
alter table public.product_costs          enable row level security;
alter table public.money_entries          enable row level security;

-- Locations: everyone can read.
create policy "Anyone can view governorates"
  on public.lebanon_governorates for select to anon, authenticated using (true);
create policy "Anyone can view districts"
  on public.lebanon_districts for select to anon, authenticated using (true);

-- Delivery fees: public for active shops; owners manage.
create policy "Public can view delivery fees of active shops"
  on public.shop_delivery_fees for select to anon, authenticated
  using (exists (select 1 from public.shops s where s.id = shop_id and s.is_active));
create policy "Members can view their delivery fees"
  on public.shop_delivery_fees for select to authenticated
  using (private.is_shop_member(shop_id));
create policy "Owners can manage their delivery fees"
  on public.shop_delivery_fees for all to authenticated
  using (private.is_shop_owner(shop_id))
  with check (private.is_shop_owner(shop_id));

-- Private settings: members read, owners change.
create policy "Members can view their private settings"
  on public.shop_private_settings for select to authenticated
  using (private.is_shop_member(shop_id));
create policy "Owners can change their private settings"
  on public.shop_private_settings for update to authenticated
  using (private.is_shop_owner(shop_id))
  with check (private.is_shop_owner(shop_id));

-- Option types / values: public for visible products; members manage.
create policy "Public can view option types of visible products"
  on public.product_option_types for select to anon, authenticated
  using (exists (
    select 1 from public.products p join public.shops s on s.id = p.shop_id
    where p.id = product_id and p.is_active and s.is_active));
create policy "Members can manage their option types"
  on public.product_option_types for all to authenticated
  using (private.is_shop_member(shop_id))
  with check (private.is_shop_member(shop_id));

create policy "Public can view option values of visible products"
  on public.product_option_values for select to anon, authenticated
  using (exists (
    select 1 from public.products p join public.shops s on s.id = p.shop_id
    where p.id = product_id and p.is_active and s.is_active));
create policy "Members can manage their option values"
  on public.product_option_values for all to authenticated
  using (private.is_shop_member(shop_id))
  with check (private.is_shop_member(shop_id));

-- Photos: public for visible products; members manage.
create policy "Public can view photos of visible products"
  on public.product_photos for select to anon, authenticated
  using (exists (
    select 1 from public.products p join public.shops s on s.id = p.shop_id
    where p.id = product_id and p.is_active and s.is_active));
create policy "Members can manage their photos"
  on public.product_photos for all to authenticated
  using (private.is_shop_member(shop_id))
  with check (private.is_shop_member(shop_id));

-- Costs and money: members only, never public.
create policy "Members can manage their product costs"
  on public.product_costs for all to authenticated
  using (private.is_shop_member(shop_id))
  with check (private.is_shop_member(shop_id));
create policy "Members can manage their money entries"
  on public.money_entries for all to authenticated
  using (private.is_shop_member(shop_id))
  with check (private.is_shop_member(shop_id));


-- =====================================================================
-- 11. GRANTS
-- =====================================================================
revoke all on public.lebanon_governorates, public.lebanon_districts,
              public.shop_delivery_fees, public.shop_private_settings,
              public.product_option_types, public.product_option_values,
              public.product_photos, public.product_costs, public.money_entries
  from public, anon, authenticated;

revoke all on function private.create_shop_private_settings()   from public, anon, authenticated;
revoke all on function private.is_valid_label_list(text[])      from public, anon, authenticated;
revoke all on function private.sync_product_option_label(uuid)  from public, anon, authenticated;
revoke all on function private.on_option_type_change()          from public, anon, authenticated;
revoke all on function private.prepare_variant()                from public, anon, authenticated;
revoke all on function private.on_option_value_rename()         from public, anon, authenticated;

-- The categories check runs when members save products.
grant execute on function private.is_valid_label_list(text[]) to authenticated, service_role;

-- anon (visitors): public lists + public catalog parts only.
grant select on public.lebanon_governorates, public.lebanon_districts,
                public.shop_delivery_fees, public.product_option_types,
                public.product_option_values, public.product_photos
  to anon;

-- authenticated (RLS above limits the rows):
grant select on public.lebanon_governorates, public.lebanon_districts to authenticated;
grant select, insert, delete on public.shop_delivery_fees to authenticated;
grant update (fee) on public.shop_delivery_fees to authenticated;
grant select on public.shop_private_settings to authenticated;
grant update (initial_investment, invoice_prefix) on public.shop_private_settings to authenticated;
grant select, insert, update, delete on public.product_option_types,
                                        public.product_option_values,
                                        public.product_photos,
                                        public.product_costs,
                                        public.money_entries
  to authenticated;

-- New public shop settings: owners may change them (RLS: owners only).
grant update (delivery_on, delivery_mode, free_delivery_on, free_delivery_above,
              delivery_note, description_on, policy_on, policy_text, low_stock_at,
              instagram, facebook, primary_color, accent_color, hero_text,
              reviews_on, reviews_need_approval)
  on public.shops to authenticated;

-- service_role (trusted server code):
grant all on public.lebanon_governorates, public.lebanon_districts,
             public.shop_delivery_fees, public.shop_private_settings,
             public.product_option_types, public.product_option_values,
             public.product_photos, public.product_costs, public.money_entries
  to service_role;
