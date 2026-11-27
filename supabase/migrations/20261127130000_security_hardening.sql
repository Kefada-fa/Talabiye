-- =====================================================================
-- Security hardening (step 4 review). Run once, after
-- 20261127120000_initial_schema.sql, in the Supabase SQL Editor.
--
-- Fixes:
--   1. get_phone_risk: caller must be a member of an ACTIVE shop
--      (before: a member of any shop, even an inactive one).
--   2. place_order:
--      a. each cart entry is validated on its own: quantity must be a
--         whole number 1–20 (before: entries were merged first, so a
--         negative entry could hide inside a positive total).
--      b. limits: max 20 of each item (after merging duplicates),
--         max 30 entries per order (before: 100 and 50).
--      c. no longer returns confirm_token to the person ordering.
--         The token must only reach the customer's own phone (WhatsApp
--         link), otherwise a fake order could confirm itself.
--      d. an existing customer's name is no longer overwritten by a
--         new order using their phone number.
-- Function signatures are unchanged.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. get_phone_risk — members of ACTIVE shops only
-- ---------------------------------------------------------------------
create or replace function public.get_phone_risk(p_phone text)
returns table (delivered integer, refused integer)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_hash text;
begin
  if (select auth.uid()) is null
     or not exists (
       select 1
       from public.shop_members m
       join public.shops s on s.id = m.shop_id
       where m.user_id = (select auth.uid())
         and s.is_active
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

-- ---------------------------------------------------------------------
-- 2. place_order — stricter cart checks, no confirm_token in the reply
-- ---------------------------------------------------------------------
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
  -- One customer per phone per shop. The existing NAME is kept (so a
  -- stranger using the same number can't rename them); area/address
  -- are only "last used" pre-fill values, each order keeps its own copy.
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
  -- Same product+option listed twice is merged into one line.
  -- Sorted so concurrent orders lock rows in the same order (no deadlocks).
  for v_item in
    select (e ->> 'product_id')::uuid                         as product_id,
           (nullif(e ->> 'variant_id', ''))::uuid              as variant_id,
           sum((e ->> 'quantity')::numeric::integer)           as quantity  -- "2.0" → 2
    from jsonb_array_elements(p_items) as e
    group by 1, 2
    order by 1, 2
  loop
    if v_item.quantity > c_max_qty_per_item then
      raise exception 'You can order at most % of each item', c_max_qty_per_item;
    end if;

    -- Lock the product row: a second order for the same product waits
    -- here until this one finishes, then sees the updated stock.
    select * into v_product
    from public.products p
    where p.id = v_item.product_id
      and p.shop_id = v_shop.id      -- must belong to THIS shop
      and p.is_active                -- must be active
    for update;
    if not found then
      raise exception 'A product in your cart is no longer available';
    end if;

    if exists (select 1 from public.product_variants pv where pv.product_id = v_product.id) then
      -- Product has options (size, flavor, color…): one must be chosen.
      if v_item.variant_id is null then
        raise exception 'Please choose a % for %',
          lower(coalesce(v_product.option_label, 'option')), v_product.name;
      end if;

      select * into v_variant
      from public.product_variants pv
      where pv.id = v_item.variant_id
        and pv.product_id = v_product.id   -- must be an option of THIS product
        and pv.shop_id = v_shop.id
      for update;                          -- lock the option's stock row
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
      -- Product without options: stock lives on the product (if tracked).
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
  end loop;

  -- ---- 5. Save totals -------------------------------------------------
  update public.orders o
    set subtotal = v_subtotal,
        total    = v_subtotal + o.delivery_fee
  where o.id = v_order_id;

  -- Note: confirm_token is intentionally NOT returned.
  return jsonb_build_object(
    'order_id',      v_order_id,
    'order_number',  v_order_number,
    'subtotal',      v_subtotal,
    'delivery_fee',  v_shop.delivery_fee,
    'total',         v_subtotal + v_shop.delivery_fee
  );
end;
$$;

-- ---------------------------------------------------------------------
-- 3. Re-state function permissions (create or replace keeps them, but
--    being explicit protects against any default grants).
-- ---------------------------------------------------------------------
revoke all on function public.place_order(text, text, text, text, text, jsonb, text, text)
  from public, anon, authenticated;
revoke all on function public.get_phone_risk(text) from public, anon, authenticated;

grant execute on function public.place_order(text, text, text, text, text, jsonb, text, text)
  to anon, authenticated;
grant execute on function public.get_phone_risk(text) to authenticated;
