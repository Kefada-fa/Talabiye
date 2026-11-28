-- =====================================================================
-- Step 9: Inventory.
-- Run once, after 20261128170000_settings_grants_fix.sql.
--
--   1. Costs are OWNERS ONLY (was: all members). Staff can't read
--      product_costs, nor the cost column of order lines.
--   2. Products: members add/edit; only OWNERS delete.
--   3. plan_limits: photos per item by plan (read-only for shops).
--   4. Product photos: max per item (from plan_limits), own folder,
--      a photo per option value; Storage bucket "product-photos".
--   5. stock_changes: automatic stock history (read-only).
--   6. save_product(): the whole item in one all-or-nothing call.
--   7. change_stock(): quick +/- and "start counting".
--   8. product_buyers(): "Who bought it".
--   9. Order functions write the reason of stock changes.
-- =====================================================================


-- =====================================================================
-- 1. COSTS: OWNERS ONLY
-- =====================================================================
drop policy "Members can manage their product costs" on public.product_costs;
create policy "Owners can manage their product costs"
  on public.product_costs for all to authenticated
  using (private.is_shop_owner(shop_id))
  with check (private.is_shop_owner(shop_id));

-- Order lines: every column EXCEPT cost (the wholesale-price snapshot).
-- Owners will get costs through owner-only functions (reports, invoices).
revoke select on public.order_items from authenticated;
grant select (id, created_at, shop_id, order_id, product_id, variant_id, name, unit_price,
              quantity, code, option_label, list_price, photo)
  on public.order_items to authenticated;


-- =====================================================================
-- 2. PRODUCTS: members add/edit, owners delete
-- =====================================================================
drop policy "Members can manage their products" on public.products;
create policy "Members can view their products"
  on public.products for select to authenticated
  using (private.is_shop_member(shop_id));
create policy "Members can add products"
  on public.products for insert to authenticated
  with check (private.is_shop_member(shop_id));
create policy "Members can edit their products"
  on public.products for update to authenticated
  using (private.is_shop_member(shop_id))
  with check (private.is_shop_member(shop_id));
create policy "Owners can delete their products"
  on public.products for delete to authenticated
  using (private.is_shop_owner(shop_id));

-- Sanity limits on the item fields.
alter table public.products
  add constraint products_price_max check (price <= 1000000);


-- =====================================================================
-- 3. PLAN LIMITS (platform settings; shops can only read)
-- =====================================================================
create table public.plan_limits (
  plan                text primary key check (plan in ('free', 'starter', 'pro')),
  created_at          timestamptz not null default now(),
  max_product_photos  integer not null check (max_product_photos between 1 and 50)
);
-- Change these numbers here (or later in an admin screen) — nowhere else.
insert into public.plan_limits (plan, max_product_photos) values
  ('free', 10), ('starter', 10), ('pro', 10);

alter table public.plan_limits enable row level security;
create policy "Logged-in users can view plan limits"
  on public.plan_limits for select to authenticated using (true);
revoke all on public.plan_limits from public, anon, authenticated;
grant select on public.plan_limits to authenticated;
grant all on public.plan_limits to service_role;

-- Photos allowed per item for a shop (by its plan).
create function private.max_product_photos(p_shop_id uuid)
returns integer
language sql stable security definer set search_path = ''
as $$
  select coalesce((select l.max_product_photos
                   from public.shops s join public.plan_limits l on l.plan = s.plan
                   where s.id = p_shop_id), 10);
$$;


-- =====================================================================
-- 4. PRODUCT PHOTOS
-- =====================================================================
alter table public.product_photos
  add constraint product_photos_id_product_key unique (id, product_id),
  add constraint product_photos_position_range check (position between 0 and 1000),
  -- Inside the item's own folder: "<shop id>/<product id>/<random>.webp"
  -- (full https:// links stay allowed for older data).
  add constraint product_photos_own_folder check (
    storage_path ~ '^https?://'
    or (storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[A-Za-z0-9-]{1,64}\.(webp|jpg|png)$'
        and split_part(storage_path, '/', 1) = shop_id::text
        and split_part(storage_path, '/', 2) = product_id::text)
  ) not valid;

-- Max photos per item (one setting: plan_limits).
create function private.check_product_photo_limit()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_max integer := private.max_product_photos(new.shop_id);
begin
  perform pg_advisory_xact_lock(hashtextextended('product_photos:' || new.product_id::text, 0));
  if (select count(*) from public.product_photos p where p.product_id = new.product_id) >= v_max then
    raise exception 'An item can have at most % photos', v_max using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger product_photos_limit
  before insert on public.product_photos
  for each row execute function private.check_product_photo_limit();

-- A photo for each option value (e.g. Color: Red → its red photo).
alter table public.product_option_values
  add column photo_id uuid,
  add constraint product_option_values_photo_fk foreign key (photo_id, product_id)
    references public.product_photos (id, product_id) on delete set null (photo_id);

-- Storage bucket for product photos (public read, 300 KB, images only).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-photos', 'product-photos', true, 307200, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- True when the file is "<shop>/<product>/<name>" for a product of a shop
-- the user is a MEMBER of. Never errors on strange names.
create function private.can_manage_product_photo(p_name text)
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_shop    text := split_part(coalesce(p_name, ''), '/', 1);
  v_product text := split_part(coalesce(p_name, ''), '/', 2);
begin
  if coalesce(p_name, '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9-]{1,64}\.(webp|jpg|png)$' then
    return false;
  end if;
  return private.is_shop_member(v_shop::uuid)
     and exists (select 1 from public.products p where p.id = v_product::uuid and p.shop_id = v_shop::uuid);
end;
$$;

create policy "Members can view their product photo files"
  on storage.objects for select to authenticated
  using (bucket_id = 'product-photos' and private.can_manage_product_photo(name));
create policy "Members can upload product photos"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'product-photos' and private.can_manage_product_photo(name));
create policy "Members can replace product photos"
  on storage.objects for update to authenticated
  using (bucket_id = 'product-photos' and private.can_manage_product_photo(name))
  with check (bucket_id = 'product-photos' and private.can_manage_product_photo(name));
create policy "Members can delete product photos"
  on storage.objects for delete to authenticated
  using (bucket_id = 'product-photos' and private.can_manage_product_photo(name));


-- =====================================================================
-- 5. STOCK HISTORY (written automatically; nobody can edit it)
-- =====================================================================
create table public.stock_changes (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  shop_id       uuid not null references public.shops (id) on delete cascade,
  product_id    uuid not null,
  variant_id    uuid,                 -- null = item without options
  option_label  text,                 -- "Color: Red / Size: M" (copy)
  stock_from    integer,              -- null = not tracked
  stock_to      integer,
  change        integer,              -- stock_to − stock_from (when both are numbers)
  reason        text not null check (reason in ('edit', 'quick_stock', 'order_placed',
                                                 'order_cancelled', 'order_refused')),
  user_id       uuid,                 -- who (null = a customer / the system)
  order_id      uuid,                 -- for order reasons (kept even if the order goes)
  foreign key (product_id, shop_id) references public.products (id, shop_id) on delete cascade,
  foreign key (variant_id) references public.product_variants (id) on delete set null
);
create index stock_changes_product_idx on public.stock_changes (product_id, created_at desc);

alter table public.stock_changes enable row level security;
create policy "Members can view their stock history"
  on public.stock_changes for select to authenticated
  using (private.is_shop_member(shop_id));
revoke all on public.stock_changes from public, anon, authenticated;
grant select on public.stock_changes to authenticated;
grant all on public.stock_changes to service_role;

-- Writes one row whenever stock changes. The reason comes from the
-- function doing the change (set_config 'app.stock_reason'); plain edits
-- default to 'edit'.
create function private.log_stock_change()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_reason   text := coalesce(nullif(current_setting('app.stock_reason', true), ''), 'edit');
  v_order    uuid := nullif(current_setting('app.stock_order_id', true), '')::uuid;
  v_old      integer := case when tg_op = 'UPDATE' then old.stock end;
  v_product  uuid;
  v_variant  uuid;
  v_label    text;
begin
  if tg_op = 'UPDATE' and old.stock is not distinct from new.stock then
    return null;
  end if;
  if tg_op = 'INSERT' and new.stock is null then
    return null;
  end if;
  if v_reason not in ('edit', 'quick_stock', 'order_placed', 'order_cancelled', 'order_refused') then
    v_reason := 'edit';
  end if;

  if tg_table_name = 'product_variants' then
    v_product := new.product_id;
    v_variant := new.id;
    select string_agg(t.name || ': ' || ov.value, ' / ' order by t.position) into v_label
    from public.product_option_values ov
    join public.product_option_types t on t.id = ov.option_type_id
    where ov.id in (new.value1_id, new.value2_id);
    v_label := coalesce(v_label, new.label);
  else
    v_product := new.id;
  end if;

  insert into public.stock_changes
    (shop_id, product_id, variant_id, option_label, stock_from, stock_to, change, reason, user_id, order_id)
  values
    (new.shop_id, v_product, v_variant, v_label, v_old, new.stock, new.stock - v_old, v_reason,
     (select auth.uid()), case when v_reason like 'order_%' then v_order end);
  return null;
end;
$$;

create trigger products_log_stock
  after insert or update of stock on public.products
  for each row execute function private.log_stock_change();
create trigger product_variants_log_stock
  after insert or update of stock on public.product_variants
  for each row execute function private.log_stock_change();


-- =====================================================================
-- 6. SAVE A WHOLE ITEM (all or nothing)
-- =====================================================================
-- New collection / category names typed on the item page are added to
-- the shop's lists (any member). Renaming / deleting stays owner-only.
create function private.ensure_catalog_labels(p_shop_id uuid, p_collection text, p_categories text[])
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_name text;
begin
  if not private.is_shop_member(p_shop_id) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_collection is not null then
    insert into public.shop_catalog_labels (shop_id, kind, name, position)
    select p_shop_id, 'collection', p_collection,
           coalesce((select max(position) from public.shop_catalog_labels
                     where shop_id = p_shop_id and kind = 'collection'), 0) + 1
    where not exists (select 1 from public.shop_catalog_labels l
                      where l.shop_id = p_shop_id and l.kind = 'collection' and lower(l.name) = lower(p_collection));
  end if;
  foreach v_name in array coalesce(p_categories, '{}') loop
    insert into public.shop_catalog_labels (shop_id, kind, name, position)
    select p_shop_id, 'category', v_name,
           coalesce((select max(position) from public.shop_catalog_labels
                     where shop_id = p_shop_id and kind = 'category'), 0) + 1
    where not exists (select 1 from public.shop_catalog_labels l
                      where l.shop_id = p_shop_id and l.kind = 'category' and lower(l.name) = lower(v_name));
  end loop;
end;
$$;

/*
  p_product_id: null = new item (p_data.id may give the new id).
  p_data: {
    id?, name, code, description, price, sale_price, collection, categories[],
    is_active, brand, expiry_date, barcode, weight,
    stock,                       -- items WITHOUT options (null = not tracked)
    cost?,                       -- OWNERS only; key missing = don't touch; null = remove
    types: [ { id?, name, values: [ { key, id?, value, photo_id? } ] } ],   -- 0 to 2
    variants: [ { v1: key, v2: key?, stock: int|null, price: number|null, stock_base? } ]  -- full grid
  }
  stock_base (here and next to "stock" for items without options) = the
  stock shown when the page was opened. A box left unchanged keeps the
  CURRENT stock (orders / quick stock meanwhile are not undone); a changed
  box whose stock also changed meanwhile is refused ("reload").
  Returns { product_id, value_ids: { key: id } }.
*/
create function public.save_product(p_shop_id uuid, p_product_id uuid, p_data jsonb)
returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_id          uuid;
  v_types       jsonb := coalesce(p_data -> 'types', '[]'::jsonb);
  v_variants    jsonb := coalesce(p_data -> 'variants', '[]'::jsonb);
  v_ntypes      integer;
  v_keys        jsonb := '{}'::jsonb;
  v_type        jsonb;
  v_val         jsonb;
  v_var         jsonb;
  v_type_id     uuid;
  v_value_id    uuid;
  v_pos         integer := 0;
  v_vpos        integer;
  v_keep        uuid[];
  v_keep_vars   uuid[] := '{}';
  v_v1          uuid;
  v_v2          uuid;
  v_var_id      uuid;
  v_stock       integer;
  v_price       numeric;
  v_expected    integer := 1;
  v_cur         integer;
  v_base        integer;
  v_collection  text;
  v_categories  text[];
  v_name        text;
begin
  if p_shop_id is null or not private.is_shop_member(p_shop_id) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object'
     or jsonb_typeof(v_types) <> 'array' or jsonb_typeof(v_variants) <> 'array' then
    raise exception 'Invalid item' using errcode = '22023';
  end if;
  v_ntypes := jsonb_array_length(v_types);
  if v_ntypes > 2 then
    raise exception 'An item can have at most 2 option types' using errcode = '23514';
  end if;

  perform set_config('app.stock_reason', 'edit', true);

  v_name := trim(coalesce(p_data ->> 'name', ''));
  v_collection := nullif(trim(coalesce(p_data ->> 'collection', '')), '');
  if char_length(v_collection) > 50 then
    raise exception 'Collection names must be 1 to 50 characters' using errcode = '23514';
  end if;
  select coalesce(array_agg(c order by o), '{}') into v_categories
  from (select distinct on (lower(trim(c))) trim(c) as c, o
        from jsonb_array_elements_text(coalesce(p_data -> 'categories', '[]'::jsonb)) with ordinality as e(c, o)
        where trim(c) <> ''
        order by lower(trim(c)), o) x;
  if exists (select 1 from unnest(v_categories) c where char_length(c) > 50) then
    raise exception 'Category names must be 1 to 50 characters' using errcode = '23514';
  end if;

  -- ---- The item itself ----
  if p_product_id is null then
    v_id := coalesce(nullif(p_data ->> 'id', '')::uuid, gen_random_uuid());
    insert into public.products (id, shop_id, name, price)
    values (v_id, p_shop_id, v_name, coalesce((p_data ->> 'price')::numeric, 0));
  else
    select p.id into v_id from public.products p
    where p.id = p_product_id and p.shop_id = p_shop_id
    for update;
    if not found then
      raise exception 'Item not found' using errcode = 'P0002';
    end if;
  end if;

  update public.products
     set name        = v_name,
         description = nullif(trim(coalesce(p_data ->> 'description', '')), ''),
         price       = (p_data ->> 'price')::numeric,
         sale_price  = nullif(p_data ->> 'sale_price', '')::numeric,
         code        = nullif(trim(coalesce(p_data ->> 'code', '')), ''),
         collection  = v_collection,
         categories  = v_categories,
         is_active   = coalesce((p_data ->> 'is_active')::boolean, true),
         brand       = nullif(trim(coalesce(p_data ->> 'brand', '')), ''),
         expiry_date = nullif(p_data ->> 'expiry_date', '')::date,
         barcode     = nullif(trim(coalesce(p_data ->> 'barcode', '')), ''),
         weight      = nullif(trim(coalesce(p_data ->> 'weight', '')), '')
   where id = v_id;

  perform private.ensure_catalog_labels(p_shop_id, v_collection, v_categories);

  -- ---- Wholesale price: owners only ----
  if p_data ? 'cost' then
    if not private.is_shop_owner(p_shop_id) then
      raise exception 'Only the shop owner can change the wholesale price' using errcode = '42501';
    end if;
    if jsonb_typeof(p_data -> 'cost') = 'number' then
      insert into public.product_costs (shop_id, product_id, wholesale_price)
      values (p_shop_id, v_id, (p_data ->> 'cost')::numeric)
      on conflict (product_id) do update set wholesale_price = excluded.wholesale_price;
    else
      delete from public.product_costs where product_id = v_id;
    end if;
  end if;

  -- ---- Option types + values ----
  select coalesce(array_agg((t ->> 'id')::uuid), '{}') into v_keep
  from jsonb_array_elements(v_types) t where nullif(t ->> 'id', '') is not null;
  delete from public.product_option_types where product_id = v_id and id <> all (v_keep);

  for v_type in select value from jsonb_array_elements(v_types) loop
    v_pos := v_pos + 1;
    if char_length(trim(coalesce(v_type ->> 'name', ''))) not between 1 and 50 then
      raise exception 'Option names must be 1 to 50 characters' using errcode = '23514';
    end if;
    if jsonb_typeof(v_type -> 'values') <> 'array' or jsonb_array_length(v_type -> 'values') not between 1 and 50 then
      raise exception '% needs 1 to 50 values', trim(v_type ->> 'name') using errcode = '23514';
    end if;
    v_expected := v_expected * jsonb_array_length(v_type -> 'values');

    if nullif(v_type ->> 'id', '') is not null then
      update public.product_option_types
         set name = trim(v_type ->> 'name'), position = v_pos
       where id = (v_type ->> 'id')::uuid and product_id = v_id
      returning id into v_type_id;
      if v_type_id is null then
        raise exception 'An option type was not found' using errcode = 'P0002';
      end if;
    else
      insert into public.product_option_types (shop_id, product_id, position, name)
      values (p_shop_id, v_id, v_pos, trim(v_type ->> 'name'))
      returning id into v_type_id;
    end if;

    select coalesce(array_agg((x ->> 'id')::uuid), '{}') into v_keep
    from jsonb_array_elements(v_type -> 'values') x where nullif(x ->> 'id', '') is not null;
    delete from public.product_option_values where option_type_id = v_type_id and id <> all (v_keep);
    -- temporary names, so renames like A→B, B→A never clash
    update public.product_option_values set value = '~' || id::text where option_type_id = v_type_id;

    v_vpos := 0;
    for v_val in select value from jsonb_array_elements(v_type -> 'values') loop
      v_vpos := v_vpos + 1;
      if char_length(trim(coalesce(v_val ->> 'value', ''))) not between 1 and 100 then
        raise exception 'Option values must be 1 to 100 characters' using errcode = '23514';
      end if;
      v_value_id := null;
      if nullif(v_val ->> 'id', '') is not null then
        update public.product_option_values
           set value = trim(v_val ->> 'value'), position = v_vpos,
               photo_id = nullif(v_val ->> 'photo_id', '')::uuid
         where id = (v_val ->> 'id')::uuid and option_type_id = v_type_id
        returning id into v_value_id;
        if v_value_id is null then
          raise exception 'An option value was not found' using errcode = 'P0002';
        end if;
      else
        insert into public.product_option_values (shop_id, product_id, option_type_id, value, position, photo_id)
        values (p_shop_id, v_id, v_type_id, trim(v_val ->> 'value'), v_vpos, nullif(v_val ->> 'photo_id', '')::uuid)
        returning id into v_value_id;
      end if;
      v_keys := v_keys || jsonb_build_object(coalesce(v_val ->> 'key', v_value_id::text), v_value_id::text);
    end loop;
    v_type_id := null;
  end loop;

  -- ---- Stock: one box, or one per value / combination ----
  if v_ntypes = 0 then
    delete from public.product_variants where product_id = v_id;
    v_stock := case when jsonb_typeof(p_data -> 'stock') = 'number' then (p_data ->> 'stock')::integer end;
    if v_stock < 0 then
      raise exception 'Stock can''t be negative' using errcode = '23514';
    end if;
    if p_data ? 'stock_base' then
      select stock into v_cur from public.products where id = v_id;
      v_base := case when jsonb_typeof(p_data -> 'stock_base') = 'number' then (p_data ->> 'stock_base')::integer end;
      if v_stock is not distinct from v_base then
        v_stock := v_cur;                       -- not touched: keep the current stock
      elsif v_cur is distinct from v_base then
        raise exception 'Stock changed while you were editing (a new order or a quick stock change). Reload the page and try again.';
      end if;
    end if;
    update public.products set stock = v_stock where id = v_id;
  else
    update public.products set stock = null where id = v_id and stock is not null;
    delete from public.product_variants where product_id = v_id and value1_id is null;  -- older data

    for v_var in select value from jsonb_array_elements(v_variants) loop
      v_v1 := (v_keys ->> (v_var ->> 'v1'))::uuid;
      v_v2 := case when v_ntypes = 2 then (v_keys ->> (v_var ->> 'v2'))::uuid end;
      if v_v1 is null or (v_ntypes = 2 and v_v2 is null) then
        raise exception 'Invalid option combination' using errcode = '22023';
      end if;
      v_stock := case when jsonb_typeof(v_var -> 'stock') = 'number' then (v_var ->> 'stock')::integer end;
      v_price := case when jsonb_typeof(v_var -> 'price') = 'number' then (v_var ->> 'price')::numeric end;
      if v_stock < 0 then
        raise exception 'Stock can''t be negative' using errcode = '23514';
      end if;
      if v_price < 0 or v_price > 1000000 then
        raise exception 'Option prices must be from 0 to 1000000' using errcode = '23514';
      end if;

      v_var_id := null;
      v_cur := null;
      select pv.id, pv.stock into v_var_id, v_cur from public.product_variants pv
      where pv.product_id = v_id and pv.value1_id = v_v1 and pv.value2_id is not distinct from v_v2
      for update;
      if v_var_id is not null and v_var ? 'stock_base' then
        v_base := case when jsonb_typeof(v_var -> 'stock_base') = 'number' then (v_var ->> 'stock_base')::integer end;
        if v_stock is not distinct from v_base then
          v_stock := v_cur;                     -- not touched: keep the current stock
        elsif v_cur is distinct from v_base then
          raise exception 'Stock changed while you were editing (a new order or a quick stock change). Reload the page and try again.';
        end if;
      end if;

      if v_var_id is not null then
        update public.product_variants pv
           set label = left(a.value || coalesce(' / ' || b.value, ''), 100), stock = v_stock,
               price_override = v_price, sort_order = a.position * 1000 + coalesce(b.position, 0)
          from public.product_option_values a
          left join public.product_option_values b on b.id = v_v2
         where pv.id = v_var_id and a.id = v_v1;
      else
        insert into public.product_variants
          (shop_id, product_id, value1_id, value2_id, label, stock, price_override, sort_order)
        select p_shop_id, v_id, v_v1, v_v2,
               left(a.value || coalesce(' / ' || b.value, ''), 100), v_stock, v_price,
               a.position * 1000 + coalesce(b.position, 0)
        from public.product_option_values a
        left join public.product_option_values b on b.id = v_v2
        where a.id = v_v1
        returning id into v_var_id;
      end if;
      v_keep_vars := v_keep_vars || v_var_id;
    end loop;

    delete from public.product_variants where product_id = v_id and id <> all (v_keep_vars);
    if (select count(*) from public.product_variants where product_id = v_id) <> v_expected then
      raise exception 'Every option combination needs a stock box' using errcode = '22023';
    end if;
  end if;

  perform set_config('app.stock_reason', '', true);
  return jsonb_build_object('product_id', v_id, 'value_ids', v_keys);
end;
$$;

-- Link option values to photos AFTER new photos were uploaded.
-- p_links: { "<value id>": "<photo id>" | null }
create function public.set_value_photos(p_product_id uuid, p_links jsonb)
returns void
language plpgsql security invoker set search_path = ''
as $$
declare
  v_shop uuid := (select shop_id from public.products where id = p_product_id);
  v_key  text;
begin
  if v_shop is null or not private.is_shop_member(v_shop) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if jsonb_typeof(p_links) <> 'object' then
    raise exception 'Invalid photo links' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_links) loop
    update public.product_option_values
       set photo_id = nullif(p_links ->> v_key, '')::uuid
     where id = v_key::uuid and product_id = p_product_id;
  end loop;
end;
$$;


-- =====================================================================
-- 7. QUICK STOCK
-- =====================================================================
-- p_delta: +1 / −1 …   OR   p_set: an exact number (0 = "start counting").
-- p_variant_id null = item without options. Returns the new stock.
create function public.change_stock(p_product_id uuid, p_variant_id uuid, p_delta integer, p_set integer)
returns integer
language plpgsql security invoker set search_path = ''
as $$
declare
  v_shop  uuid;
  v_old   integer;
  v_new   integer;
begin
  select shop_id into v_shop from public.products where id = p_product_id;
  if v_shop is null or not private.is_shop_member(v_shop) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if (p_delta is null) = (p_set is null) then
    raise exception 'Give a change or a number' using errcode = '22023';
  end if;

  if p_variant_id is null then
    if exists (select 1 from public.product_variants where product_id = p_product_id) then
      raise exception 'Choose an option' using errcode = '22023';
    end if;
    select stock into v_old from public.products where id = p_product_id for update;
  else
    select stock into v_old from public.product_variants
    where id = p_variant_id and product_id = p_product_id for update;
    if not found then
      raise exception 'Option not found' using errcode = 'P0002';
    end if;
  end if;

  if p_set is not null then
    v_new := p_set;
  elsif v_old is null then
    raise exception 'This stock is not tracked. Start counting first.' using errcode = '22023';
  else
    v_new := v_old + p_delta;
  end if;
  if v_new < 0 then
    raise exception 'Stock can''t go below 0' using errcode = '23514';
  end if;
  if v_new > 1000000 then
    raise exception 'That is too much stock' using errcode = '23514';
  end if;

  perform set_config('app.stock_reason', 'quick_stock', true);
  if p_variant_id is null then
    update public.products set stock = v_new where id = p_product_id;
  else
    update public.product_variants set stock = v_new where id = p_variant_id;
  end if;
  perform set_config('app.stock_reason', '', true);
  return v_new;
end;
$$;


-- =====================================================================
-- 8. WHO BOUGHT IT (members; this shop's orders only; no cancelled)
-- =====================================================================
create function public.product_buyers(p_product_id uuid)
returns table (
  order_id        uuid,
  display_number  text,
  status          text,
  created_at      timestamptz,
  customer_name   text,
  option_label    text,
  variant_id      uuid,
  quantity        integer
)
language plpgsql stable security invoker set search_path = ''
as $$
declare
  v_shop uuid := (select p.shop_id from public.products p where p.id = p_product_id);
begin
  if v_shop is null or not private.is_shop_member(v_shop) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  return query
  select o.id, o.display_number, o.status, o.created_at, c.name, oi.option_label, oi.variant_id, oi.quantity
  from public.order_items oi
  join public.orders o on o.id = oi.order_id and o.shop_id = v_shop
  left join public.customers c on c.id = o.customer_id
  where oi.product_id = p_product_id and oi.shop_id = v_shop and o.status <> 'cancelled'
  order by o.created_at desc
  limit 500;
end;
$$;


-- =====================================================================
-- 9. ORDERS WRITE THE REASON OF STOCK CHANGES
-- =====================================================================
-- Cancel / refuse gives stock back (same as before) — now labelled.
create or replace function private.on_order_status_change()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.status is not distinct from old.status then
    return null;
  end if;

  -- Cancelled or refused: give the stock back (only where stock is tracked).
  if new.status in ('cancelled', 'refused') then
    perform set_config('app.stock_reason', 'order_' || new.status, true);
    perform set_config('app.stock_order_id', new.id::text, true);

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

    perform set_config('app.stock_reason', '', true);
    perform set_config('app.stock_order_id', '', true);
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


-- =====================================================================
-- Function permissions
-- =====================================================================
revoke all on function private.max_product_photos(uuid) from public, anon, authenticated;
revoke all on function private.check_product_photo_limit() from public, anon, authenticated;
revoke all on function private.can_manage_product_photo(text) from public, anon, authenticated;
grant execute on function private.can_manage_product_photo(text) to authenticated;
revoke all on function private.log_stock_change() from public, anon, authenticated;
revoke all on function private.ensure_catalog_labels(uuid, text, text[]) from public, anon, authenticated;
grant execute on function private.ensure_catalog_labels(uuid, text, text[]) to authenticated;

revoke all on function public.save_product(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.set_value_photos(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.change_stock(uuid, uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.product_buyers(uuid) from public, anon, authenticated;
grant execute on function public.save_product(uuid, uuid, jsonb) to authenticated, service_role;
grant execute on function public.set_value_photos(uuid, jsonb) to authenticated, service_role;
grant execute on function public.change_stock(uuid, uuid, integer, integer) to authenticated, service_role;
grant execute on function public.product_buyers(uuid) to authenticated, service_role;


-- =====================================================================
-- place_order: label its stock changes "order placed"
-- (same function as before; only the two set_config blocks are new)
-- =====================================================================
create or replace function public.place_order(
  p_shop_slug        text,
  p_customer_name    text,
  p_customer_phone   text,
  p_method           text,      -- 'pickup' | 'delivery'
  p_governorate      text,
  p_district         text,
  p_city             text,
  p_neighbourhood    text,
  p_street           text,
  p_details          text,
  p_notes            text,
  p_items            jsonb,     -- [{"product_id": "…", "variant_id": "…" | null, "quantity": 2}]
  p_policy_accepted  boolean
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  c_max_qty_per_item     constant integer := 20;
  c_max_entries          constant integer := 30;
  c_max_shop_per_hour    constant integer := 25;
  c_max_unconfirmed      constant integer := 3;
  c_max_phone_per_24h    constant integer := 4;

  v_shop        public.shops%rowtype;
  v_name        text;
  v_phone       text;
  v_method      text := lower(trim(coalesce(p_method, '')));
  v_gov         text;
  v_district    text;
  v_city        text;
  v_neigh       text;
  v_street      text;
  v_details     text;
  v_notes       text;
  v_gov_fee     numeric(10,2);
  v_item        record;
  v_product     public.products%rowtype;
  v_variant     public.product_variants%rowtype;
  v_option      text;
  v_available   integer;
  v_list        numeric(10,2);
  v_unit        numeric(10,2);
  v_photo       text;
  v_lines       jsonb := '[]'::jsonb;
  v_problems    jsonb := '[]'::jsonb;
  v_messages    text[] := '{}';
  v_subtotal    numeric(10,2) := 0;
  v_pieces      integer := 0;
  v_fee         numeric(10,2) := 0;
  v_free        boolean := false;
  v_customer_id uuid;
  v_order       public.orders%rowtype;
  v_line        jsonb;
  v_receipt     jsonb := '[]'::jsonb;
begin
  -- ---- 1. Shop ---------------------------------------------------------
  select * into v_shop
  from public.shops s
  where s.slug = lower(trim(p_shop_slug)) and s.is_active;
  if not found then
    raise exception 'Shop not found';
  end if;

  -- Closed by the owner (vacation mode): refuse with the shop's message.
  if not v_shop.accepting_orders then
    raise exception '%', coalesce(nullif(trim(coalesce(v_shop.closed_message, '')), ''),
                                  v_shop.name || ' is not taking orders right now. Please check back soon.');
  end if;

  -- ---- 2. Customer -----------------------------------------------------
  v_name := trim(coalesce(p_customer_name, ''));
  if v_name = '' then
    raise exception 'Please enter your name';
  end if;
  if char_length(v_name) > 100 then
    raise exception 'Name is too long (max 100 characters)';
  end if;

  v_phone := private.normalize_lb_phone(p_customer_phone);  -- mobile only, raises if invalid

  v_notes := nullif(trim(coalesce(p_notes, '')), '');
  if char_length(coalesce(v_notes, '')) > 2000 then
    raise exception 'Notes are too long (max 2000 characters)';
  end if;

  -- ---- 3. Pickup or delivery + address -----------------------------------
  if v_method not in ('pickup', 'delivery') then
    raise exception 'Please choose pickup or delivery';
  end if;

  -- Pickup only when the shop offers it (shops.pickup_on, off by default).
  if v_method = 'pickup' and not v_shop.pickup_on then
    raise exception '% does not offer pickup. Please choose delivery.', v_shop.name;
  end if;

  if v_method = 'delivery' then
    if not v_shop.delivery_on then
      if v_shop.pickup_on then
        raise exception '% does not deliver at the moment. Please choose pickup.', v_shop.name;
      else
        raise exception '% is not taking delivery orders at the moment.', v_shop.name;
      end if;
    end if;

    select g.name into v_gov
    from public.lebanon_governorates g
    where lower(g.name) = lower(trim(coalesce(p_governorate, '')));
    if v_gov is null then
      raise exception 'Please choose your governorate';
    end if;

    select d.name into v_district
    from public.lebanon_districts d
    where d.governorate = v_gov and lower(d.name) = lower(trim(coalesce(p_district, '')));
    if v_district is null then
      raise exception 'Please choose a district in %', v_gov;
    end if;

    v_city    := nullif(trim(coalesce(p_city, '')), '');
    v_street  := nullif(trim(coalesce(p_street, '')), '');
    v_neigh   := nullif(trim(coalesce(p_neighbourhood, '')), '');
    v_details := nullif(trim(coalesce(p_details, '')), '');
    if v_city is null then
      raise exception 'Please enter your city or town';
    end if;
    if v_street is null then
      raise exception 'Please enter your street';
    end if;
    if char_length(v_city) > 100 or char_length(v_street) > 200
       or char_length(coalesce(v_neigh, '')) > 100 or char_length(coalesce(v_details, '')) > 500 then
      raise exception 'Some of the address is too long';
    end if;

    -- Is there delivery to this governorate?
    if v_shop.delivery_mode = 'governorate' then
      select f.fee into v_gov_fee
      from public.shop_delivery_fees f
      where f.shop_id = v_shop.id and f.governorate = v_gov;
      if v_gov_fee is null then
        if v_shop.pickup_on then
          raise exception 'Sorry, % does not deliver to % yet. Please choose pickup or another address.', v_shop.name, v_gov;
        else
          raise exception 'Sorry, % does not deliver to % yet. Please choose another address.', v_shop.name, v_gov;
        end if;
      end if;
    end if;
  end if;

  -- ---- 4. Policy -------------------------------------------------------
  if v_shop.policy_on and not coalesce(p_policy_accepted, false) then
    raise exception 'Please accept the shop''s policy to place your order';
  end if;

  -- ---- 5. Cart shape ---------------------------------------------------
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Your cart is empty';
  end if;
  if jsonb_array_length(p_items) > c_max_entries then
    raise exception 'Too many items in one order (max %)', c_max_entries;
  end if;

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
    where x.q is null or x.q <> trunc(x.q) or x.q < 1 or x.q > c_max_qty_per_item
  ) then
    raise exception 'Each quantity must be a whole number from 1 to %', c_max_qty_per_item;
  end if;

  -- ---- 6. Spam limits (per shop) ----------------------------------------
  -- Lock per shop + phone, so two requests at the same moment are counted.
  perform pg_advisory_xact_lock(hashtextextended('place_order:' || v_shop.id::text || ':' || v_phone, 0));

  if (select count(*) from public.orders o
      where o.shop_id = v_shop.id and o.source = 'website'
        and o.created_at > now() - interval '1 hour') >= c_max_shop_per_hour then
    raise exception 'This shop is receiving a lot of orders right now. Please try again in a little while or message the shop on WhatsApp.';
  end if;

  if (select count(*) from public.orders o
      join public.customers c on c.id = o.customer_id
      where o.shop_id = v_shop.id and c.phone = v_phone and o.status = 'unconfirmed') >= c_max_unconfirmed then
    raise exception 'You already have % orders waiting for confirmation from this shop. Please wait for the shop to contact you, or message them on WhatsApp.', c_max_unconfirmed;
  end if;

  if (select count(*) from public.orders o
      join public.customers c on c.id = o.customer_id
      where o.shop_id = v_shop.id and c.phone = v_phone
        and o.created_at > now() - interval '24 hours') >= c_max_phone_per_24h then
    raise exception 'You have reached the limit of % orders in 24 hours for this shop. Please message the shop on WhatsApp.', c_max_phone_per_24h;
  end if;

  -- ---- 7. Check every line: prices + stock (rows locked) ----------------
  -- Same product + option listed twice is merged. Sorted, so parallel
  -- orders lock rows in the same order (no deadlocks).
  for v_item in
    select (e ->> 'product_id')::uuid                 as product_id,
           (nullif(e ->> 'variant_id', ''))::uuid      as variant_id,
           sum((e ->> 'quantity')::numeric::integer)   as quantity
    from jsonb_array_elements(p_items) as e
    group by 1, 2
    order by 1, 2
  loop
    if v_item.quantity > c_max_qty_per_item then
      raise exception 'You can order at most % of each item', c_max_qty_per_item;
    end if;
    v_pieces := v_pieces + v_item.quantity;

    select * into v_product
    from public.products p
    where p.id = v_item.product_id and p.shop_id = v_shop.id and p.is_active
    for update;
    if not found then
      raise exception 'A product in your cart is no longer available';
    end if;

    if exists (select 1 from public.product_variants pv where pv.product_id = v_product.id) then
      -- Product with options: one combination must be chosen.
      if v_item.variant_id is null then
        raise exception 'Please choose % for %',
          coalesce((select string_agg(t.name, ' and ' order by t.position)
                    from public.product_option_types t where t.product_id = v_product.id),
                   'an option'),
          v_product.name;
      end if;

      select * into v_variant
      from public.product_variants pv
      where pv.id = v_item.variant_id and pv.product_id = v_product.id and pv.shop_id = v_shop.id
      for update;
      if not found then
        raise exception 'An option in your cart is no longer available';
      end if;

      -- "Flavor: Chocolate" or "Color: Red / Size: M", using the seller's own names.
      select string_agg(t.name || ': ' || ov.value, ' / ' order by t.position) into v_option
      from public.product_option_values ov
      join public.product_option_types t on t.id = ov.option_type_id
      where ov.id in (v_variant.value1_id, v_variant.value2_id);
      if v_option is null then
        v_option := coalesce(v_product.option_label || ': ', '') || v_variant.label;
      end if;

      v_available := v_variant.stock;
      -- The option's own price wins; otherwise sale price, otherwise price.
      v_list := coalesce(v_variant.price_override, v_product.price);
      v_unit := coalesce(v_variant.price_override, v_product.sale_price, v_product.price);
    else
      if v_item.variant_id is not null then
        raise exception 'An option in your cart is no longer available';
      end if;
      v_option    := null;
      v_available := v_product.stock;
      v_list      := v_product.price;
      v_unit      := coalesce(v_product.sale_price, v_product.price);
    end if;

    if v_available is not null and v_available < v_item.quantity then
      v_problems := v_problems || jsonb_build_array(jsonb_build_object(
        'product_id', v_product.id,
        'variant_id', v_item.variant_id,
        'product',    v_product.name,
        'option',     v_option,
        'requested',  v_item.quantity,
        'available',  greatest(v_available, 0)
      ));
      v_messages := v_messages || (
        'Not enough stock for ' || v_product.name || coalesce(' (' || v_option || ')', '')
        || case when v_available <= 0 then ': sold out' else ': only ' || v_available || ' left' end
      );
    end if;

    select pp.storage_path into v_photo
    from public.product_photos pp
    where pp.product_id = v_product.id
    order by pp.position, pp.created_at
    limit 1;

    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'product_id',   v_product.id,
      'variant_id',   v_item.variant_id,
      'name',         v_product.name,
      'code',         v_product.code,
      'option_label', v_option,
      'list_price',   v_list,
      'unit_price',   v_unit,
      'quantity',     v_item.quantity,
      'photo',        coalesce(v_photo, v_product.image_url),
      'tracked',      v_available is not null
    ));
    v_subtotal := v_subtotal + v_unit * v_item.quantity;
  end loop;

  -- The shop's own limit (1–50, default 20).
  if v_pieces > v_shop.max_pieces then
    raise exception 'You can order at most % pieces in one order (your cart has %)', v_shop.max_pieces, v_pieces;
  end if;

  if jsonb_array_length(v_problems) > 0 then
    -- Nothing has been saved. The storefront shows this list and fixes the cart.
    return jsonb_build_object(
      'ok',             false,
      'error',          'stock',
      'message',        array_to_string(v_messages, '. ') || '.',
      'stock_problems', v_problems
    );
  end if;

  -- Minimum order (subtotal, before delivery).
  if v_shop.min_order_amount is not null and v_subtotal < v_shop.min_order_amount then
    raise exception 'Minimum order is $%. Please add a little more to your cart.',
      case when v_shop.min_order_amount = trunc(v_shop.min_order_amount)
           then to_char(v_shop.min_order_amount, 'FM999999990')
           else to_char(v_shop.min_order_amount, 'FM999999990.00') end;
  end if;

  -- ---- 8. Delivery fee (decided here, never by the browser) --------------
  if v_method = 'delivery' then
    v_fee := case when v_shop.delivery_mode = 'governorate' then v_gov_fee else v_shop.delivery_fixed end;
    if v_shop.free_delivery_on and v_subtotal >= v_shop.free_delivery_above then
      v_fee  := 0;
      v_free := true;
    end if;
  end if;

  -- ---- 9. Customer (one per phone per shop; existing name kept) ----------
  insert into public.customers (shop_id, name, phone, area, address)
  values (v_shop.id, v_name, v_phone, coalesce(v_city, v_district),
          nullif(left(concat_ws(', ', v_street, v_neigh, v_details), 500), ''))
  on conflict (shop_id, phone) do update
    set area    = coalesce(excluded.area, public.customers.area),
        address = coalesce(excluded.address, public.customers.address)
  returning id into v_customer_id;

  -- ---- 10. Order -----------------------------------------------------------
  insert into public.orders (
    shop_id, customer_id, source, status, method,
    governorate, district, city, neighbourhood, street, details, notes,
    subtotal, discount, delivery_fee, total, payment_method, policy_accepted_at
  )
  values (
    v_shop.id, v_customer_id, 'website', 'unconfirmed', v_method,
    v_gov, v_district, v_city, v_neigh, v_street, v_details, v_notes,
    v_subtotal, 0, v_fee, v_subtotal + v_fee, 'cod',
    case when v_shop.policy_on then now() end
  )
  returning * into v_order;

  -- ---- 11. Lines + hold the stock ----------------------------------------
  -- (stock history: these changes are "order placed", for this order)
  perform set_config('app.stock_reason', 'order_placed', true);
  perform set_config('app.stock_order_id', v_order.id::text, true);

  for v_line in select value from jsonb_array_elements(v_lines) loop
    insert into public.order_items (
      shop_id, order_id, product_id, variant_id, name, code, option_label,
      list_price, unit_price, quantity, photo
    )
    values (
      v_shop.id, v_order.id,
      (v_line ->> 'product_id')::uuid, (v_line ->> 'variant_id')::uuid,
      v_line ->> 'name', v_line ->> 'code', v_line ->> 'option_label',
      (v_line ->> 'list_price')::numeric, (v_line ->> 'unit_price')::numeric,
      (v_line ->> 'quantity')::integer, v_line ->> 'photo'
    );

    if (v_line ->> 'tracked')::boolean then
      if v_line ->> 'variant_id' is not null then
        update public.product_variants pv
           set stock = pv.stock - (v_line ->> 'quantity')::integer
         where pv.id = (v_line ->> 'variant_id')::uuid;
      else
        update public.products p
           set stock = p.stock - (v_line ->> 'quantity')::integer
         where p.id = (v_line ->> 'product_id')::uuid;
      end if;
    end if;

    v_receipt := v_receipt || jsonb_build_array(jsonb_build_object(
      'name',         v_line ->> 'name',
      'option_label', v_line ->> 'option_label',
      'quantity',     (v_line ->> 'quantity')::integer,
      'list_price',   (v_line ->> 'list_price')::numeric,
      'unit_price',   (v_line ->> 'unit_price')::numeric,
      'line_total',   (v_line ->> 'unit_price')::numeric * (v_line ->> 'quantity')::integer
    ));
  end loop;

  perform set_config('app.stock_reason', '', true);
  perform set_config('app.stock_order_id', '', true);

  -- Receipt for the person who just ordered — never confirm_token.
  return jsonb_build_object(
    'ok',             true,
    'order_id',       v_order.id,
    'order_number',   v_order.order_number,
    'display_number', v_order.display_number,
    'items',          v_receipt,
    'subtotal',       v_subtotal,
    'delivery_fee',   v_fee,
    'free_delivery',  v_free,
    'total',          v_subtotal + v_fee,
    'customer_name',  v_name,
    'method',         v_method,
    'governorate',    v_gov,
    'district',       v_district,
    'city',           v_city,
    'payment_method', 'cod'
  );
end;
$$;

-- Still SERVER ONLY.
revoke all on function public.place_order(text, text, text, text, text, text, text, text, text, text, text, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.place_order(text, text, text, text, text, text, text, text, text, text, text, jsonb, boolean) to service_role;
