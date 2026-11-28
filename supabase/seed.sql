-- =====================================================================
-- Starter data (run AFTER all migrations, in the Supabase SQL Editor).
--
--   1. Shop categories for the mall directory (safe to re-run).
--   2. Demo shop "kefada-demo" — mixed product types, to show the
--      platform works for ANY product:
--        • Cotton T-Shirt       options: Size (one size sold out), ON SALE
--        • Whey Protein 1kg     options: Flavor (one costs more),
--                               brand, weight, expiry date
--        • Building Blocks Set  no options, stock on the product
--        • Kids Hoodie          TWO options: Color × Size
--      Invoice prefix KF-, delivery per governorate, free delivery
--      above $60, policy text, costs.
--
-- Safe to re-run: it deletes the demo shop first (and with it all of
-- its products, customers and orders), then recreates it.
-- =====================================================================

-- ---------- 1. Shop categories ----------
insert into public.shop_categories (slug, name, sort_order) values
  ('fashion',        'Fashion & Clothing',   1),
  ('kids-toys',      'Kids & Toys',          2),
  ('health-beauty',  'Health & Beauty',      3),
  ('supplements',    'Sports & Supplements', 4),
  ('electronics',    'Electronics',          5),
  ('home',           'Home & Kitchen',       6),
  ('food',           'Food & Sweets',        7),
  ('accessories',    'Accessories & Gifts',  8),
  ('other',          'Other',                99)
on conflict (slug) do update
  set name = excluded.name, sort_order = excluded.sort_order;

-- ---------- 2. Demo shop ----------
delete from public.shops where slug = 'kefada-demo';

do $$
declare
  v_shop    uuid;
  v_prod    uuid;
  v_type    uuid;
  v_type2   uuid;
  v_val     uuid;
  v_vals    jsonb := '{}'::jsonb;  -- value name → id, per product
begin
  -- Shop + its public settings
  insert into public.shops (
    name, slug, description, category_id, whatsapp_number, is_listed, plan,
    delivery_on, delivery_mode, delivery_fixed, free_delivery_on, free_delivery_above,
    delivery_note, description_on, policy_on, policy_text, low_stock_at,
    instagram, hero_text, reviews_on, reviews_need_approval
  )
  select 'Kefada Demo', 'kefada-demo',
         'A demo shop with a bit of everything: clothes, supplements and toys.',
         c.id, '+96170000000', true, 'free',
         true, 'governorate', 4.00, true, 60.00,
         'Delivery in 2–3 working days.', true, true,
         'All sales are final and returns are not accepted. Exchanges are welcome; the delivery fee for the replacement item is covered by the customer.',
         3, 'kefada.demo', 'Everything for kids & families — delivered across Lebanon.', false, true
  from public.shop_categories c where c.slug = 'other'
  returning id into v_shop;

  -- Private settings (row created automatically with the shop)
  update public.shop_private_settings
     set invoice_prefix = 'KF', initial_investment = 1000
   where shop_id = v_shop;

  -- Delivery per governorate: Beirut $3, Mount Lebanon $4, Akkar not
  -- available (empty fee), everywhere else $5.
  insert into public.shop_delivery_fees (shop_id, governorate, fee)
  select v_shop, g.name,
         case g.name when 'Beirut' then 3 when 'Mount Lebanon' then 4 when 'Akkar' then null else 5 end
  from public.lebanon_governorates g;

  -- ===== Cotton T-Shirt: Size, on sale ($12 → $10) =====
  insert into public.products (shop_id, name, description, price, sale_price, code, collection, categories, created_at)
  values (v_shop, 'Cotton T-Shirt', 'Soft 100% cotton kids tee.', 12.00, 10.00,
          'TS-1001', 'Summer 2026', '{Boys,Girls}', now() - interval '4 minutes')
  returning id into v_prod;
  insert into public.product_costs (shop_id, product_id, wholesale_price) values (v_shop, v_prod, 5.00);
  insert into public.product_option_types (shop_id, product_id, position, name)
  values (v_shop, v_prod, 1, 'Size') returning id into v_type;
  insert into public.product_option_values (shop_id, product_id, option_type_id, value, position)
  values (v_shop, v_prod, v_type, '2Y', 1), (v_shop, v_prod, v_type, '4Y', 2), (v_shop, v_prod, v_type, '6Y', 3);
  insert into public.product_variants (shop_id, product_id, value1_id, label, stock, sort_order)
  select v_shop, v_prod, ov.id, ov.value,
         case ov.value when '2Y' then 5 when '4Y' then 8 else 0 end,   -- 6Y sold out
         ov.position
  from public.product_option_values ov where ov.option_type_id = v_type;

  -- ===== Whey Protein 1kg: Flavor, brand, weight, expiry =====
  insert into public.products (shop_id, name, description, price, code, collection, categories,
                               brand, weight, expiry_date, created_at)
  values (v_shop, 'Whey Protein 1kg', 'Whey protein powder, 33 servings.', 35.00,
          'WP-2001', 'Fitness', '{Supplements,Sports}', 'NutriMax', '1 kg', date '2027-06-30',
          now() - interval '3 minutes')
  returning id into v_prod;
  insert into public.product_costs (shop_id, product_id, wholesale_price) values (v_shop, v_prod, 20.00);
  insert into public.product_option_types (shop_id, product_id, position, name)
  values (v_shop, v_prod, 1, 'Flavor') returning id into v_type;
  insert into public.product_option_values (shop_id, product_id, option_type_id, value, position)
  values (v_shop, v_prod, v_type, 'Chocolate', 1), (v_shop, v_prod, v_type, 'Vanilla', 2),
         (v_shop, v_prod, v_type, 'Cookies & Cream', 3);
  insert into public.product_variants (shop_id, product_id, value1_id, label, stock, price_override, sort_order)
  select v_shop, v_prod, ov.id, ov.value,
         case ov.value when 'Chocolate' then 10 when 'Vanilla' then 3 else 2 end,
         case ov.value when 'Cookies & Cream' then 38.00 end,          -- costs more
         ov.position
  from public.product_option_values ov where ov.option_type_id = v_type;

  -- ===== Building Blocks Set: no options =====
  insert into public.products (shop_id, name, description, price, stock, code, barcode,
                               collection, categories, created_at)
  values (v_shop, 'Building Blocks Set', '120-piece building blocks set, ages 4+.', 25.00, 4,
          'TY-3001', '5901234123457', 'Toys', '{Kids,Gifts}', now() - interval '2 minutes')
  returning id into v_prod;
  insert into public.product_costs (shop_id, product_id, wholesale_price) values (v_shop, v_prod, 12.00);

  -- ===== Kids Hoodie: TWO options, Color × Size (no cost yet) =====
  insert into public.products (shop_id, name, description, price, code, collection, categories, created_at)
  values (v_shop, 'Kids Hoodie', 'Warm fleece hoodie with a front pocket.', 22.00,
          'HD-4001', 'Winter 2026', '{Boys,Girls}', now() - interval '1 minute')
  returning id into v_prod;
  insert into public.product_option_types (shop_id, product_id, position, name)
  values (v_shop, v_prod, 1, 'Color') returning id into v_type;
  insert into public.product_option_types (shop_id, product_id, position, name)
  values (v_shop, v_prod, 2, 'Size') returning id into v_type2;
  insert into public.product_option_values (shop_id, product_id, option_type_id, value, position)
  values (v_shop, v_prod, v_type, 'Red', 1), (v_shop, v_prod, v_type, 'Navy', 2),
         (v_shop, v_prod, v_type2, 'S', 1), (v_shop, v_prod, v_type2, 'M', 2), (v_shop, v_prod, v_type2, 'L', 3);
  -- stock per combination (Red/M and Navy/L sold out)
  insert into public.product_variants (shop_id, product_id, value1_id, value2_id, label, stock, sort_order)
  select v_shop, v_prod, c.id, s.id, c.value || ' / ' || s.value,
         case c.value || '/' || s.value
           when 'Red/S' then 2 when 'Red/M' then 0 when 'Red/L' then 3
           when 'Navy/S' then 4 when 'Navy/M' then 1 else 0 end,
         c.position * 10 + s.position
  from public.product_option_values c, public.product_option_values s
  where c.option_type_id = v_type and s.option_type_id = v_type2;
end;
$$;

-- ---------- 3. Where new-order emails go ----------
-- 👉 CHANGE THIS to your own email address (you can list several:
--    array['you@gmail.com', 'partner@gmail.com']). Then re-run this file.
update public.shop_notification_settings
   set order_emails  = array['Fawzi.s.s@hotmail.com'],
       email_enabled = true
 where shop_id = (select id from public.shops where slug = 'kefada-demo');

-- ---------- Check the result ----------
select p.code, p.name,
       coalesce(string_agg(v.label || ' (' || coalesce(v.stock::text, '∞') || ')', ', ' order by v.sort_order),
                '(no options) stock ' || p.stock) as options_and_stock,
       p.price, p.sale_price
from public.products p
join public.shops s on s.id = p.shop_id
left join public.product_variants v on v.product_id = p.id
where s.slug = 'kefada-demo'
group by p.id
order by p.created_at desc;
