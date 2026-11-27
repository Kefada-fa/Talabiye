-- =====================================================================
-- Starter data:
--   1. Shop categories for the mall directory (safe to re-run; updates names).
--   2. A demo shop "kefada-demo" with 3 different kinds of products:
--      - a T-shirt with options named "Size"
--      - a protein powder with options named "Flavor"
--      - a toy with no options (stock tracked on the product itself)
--
-- Safe to re-run: it deletes the demo shop first (and, with it, all of
-- the demo shop's products, customers and orders), then recreates it.
-- Run AFTER the migration, in the Supabase SQL Editor.
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

with new_shop as (
  insert into public.shops (name, slug, description, category_id, whatsapp_number,
                            delivery_fee, is_listed, plan)
  select 'Kefada Demo', 'kefada-demo',
         'A demo shop with a bit of everything: clothes, supplements and toys.',
         c.id, '+96170000000', 4.00, true, 'free'
  from public.shop_categories c
  where c.slug = 'other'
  returning id
),
new_products as (
  insert into public.products (shop_id, name, description, price, sort_order, option_label, stock)
  select new_shop.id, p.name, p.description, p.price, p.sort_order, p.option_label, p.stock
  from new_shop,
  (values
    ('Cotton T-Shirt',      'Soft 100% cotton kids tee.',                  12.00, 1, 'Size',   null::integer),
    ('Whey Protein 1kg',    'Whey protein powder, 33 servings.',           35.00, 2, 'Flavor', null),
    ('Building Blocks Set', '120-piece building blocks set, ages 4+.',     25.00, 3, null,     4)
  ) as p(name, description, price, sort_order, option_label, stock)
  returning id, shop_id, name
)
insert into public.product_variants (shop_id, product_id, label, stock, price_override, sort_order)
select new_products.shop_id, new_products.id, v.label, v.stock, v.price_override, v.sort_order
from new_products
join (values
  ('Cotton T-Shirt',   '2Y',              5,  null::numeric, 1),
  ('Cotton T-Shirt',   '4Y',              8,  null,          2),
  ('Cotton T-Shirt',   '6Y',              0,  null,          3),  -- out of stock, for testing
  ('Whey Protein 1kg', 'Chocolate',       10, null,          1),
  ('Whey Protein 1kg', 'Vanilla',         3,  null,          2),
  ('Whey Protein 1kg', 'Cookies & Cream', 2,  38.00,         3)   -- costs more
) as v(product_name, label, stock, price_override, sort_order)
  on v.product_name = new_products.name;

-- ---------- 3. Where new-order emails go ----------
-- 👉 CHANGE THIS to your own email address (you can list several:
--    array['you@gmail.com', 'partner@gmail.com']). Then re-run this file.
-- (The settings row itself is created automatically for every shop.)
update public.shop_notification_settings
   set order_emails  = array['your-email@example.com'],
       email_enabled = true
 where shop_id = (select id from public.shops where slug = 'kefada-demo');

-- ---------- Check the result ----------
select p.name as product,
       coalesce(p.option_label || ': ' || v.label, '(no options)') as option,
       coalesce(v.stock, p.stock) as stock,
       coalesce(v.price_override, p.price) as price_usd
from public.products p
join public.shops s on s.id = p.shop_id
left join public.product_variants v on v.product_id = p.id
where s.slug = 'kefada-demo'
order by p.sort_order, v.sort_order;
