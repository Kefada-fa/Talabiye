-- =====================================================================
-- Fix: never charge a price the customer didn't see.
-- Run once, after 20261128180000_inventory.sql.
--
-- The checkout now sends, for each cart line, the unit price shown in the
-- cart ("expected_price"). If the real price is different (the shop changed
-- the price, a sale started/ended, an option got its own price…),
-- place_order saves NOTHING and answers:
--   { ok: false, error: 'prices', message, stock_problems: [], price_changes: [
--       { product_id, variant_id, product, option, old_price, new_price, list_price } ] }
-- (with stock problems too, error = 'stock' and both lists are filled).
-- The storefront updates the cart and the customer places the order again.
-- Same function as before otherwise.
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
  p_items            jsonb,     -- [{"product_id": "…", "variant_id": "…" | null, "quantity": 2, "expected_price": 10}]
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
  v_changes     jsonb := '[]'::jsonb;   -- prices that changed since the cart was filled
  v_change_msgs text[] := '{}';
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

  -- expected_price (optional) = the unit price the customer SAW in the cart.
  if exists (
    select 1 from jsonb_array_elements(p_items) as e
    where e ? 'expected_price' and jsonb_typeof(e -> 'expected_price') <> 'number'
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
           sum((e ->> 'quantity')::numeric::integer)   as quantity,
           min((e ->> 'expected_price')::numeric)      as expected_min,
           max((e ->> 'expected_price')::numeric)      as expected_max
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

    -- The price changed since it was put in the cart: don't charge a price
    -- the customer never saw.
    if v_item.expected_min is not null
       and (round(v_item.expected_min, 2) <> v_unit or round(v_item.expected_max, 2) <> v_unit) then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object(
        'product_id', v_product.id,
        'variant_id', v_item.variant_id,
        'product',    v_product.name,
        'option',     v_option,
        'old_price',  round(v_item.expected_max, 2),
        'new_price',  v_unit,
        'list_price', v_list
      ));
      v_change_msgs := v_change_msgs || (
        v_product.name || coalesce(' (' || v_option || ')', '') || ': was $' ||
        to_char(round(v_item.expected_max, 2), 'FM999999990.00') || ', now $' || to_char(v_unit, 'FM999999990.00')
      );
    end if;
  end loop;

  -- The shop's own limit (1–50, default 20).
  if v_pieces > v_shop.max_pieces then
    raise exception 'You can order at most % pieces in one order (your cart has %)', v_shop.max_pieces, v_pieces;
  end if;

  if jsonb_array_length(v_problems) > 0 or jsonb_array_length(v_changes) > 0 then
    -- Nothing has been saved. The storefront shows these lists and fixes
    -- the cart (quantities and prices); the customer then orders again.
    return jsonb_build_object(
      'ok',             false,
      'error',          case when jsonb_array_length(v_problems) > 0 then 'stock' else 'prices' end,
      'message',        array_to_string(v_messages || v_change_msgs, '. ') || '.',
      'stock_problems', v_problems,
      'price_changes',  v_changes
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
