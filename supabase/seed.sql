-- =====================================================================
-- Demo data: one shop ("kefada-demo") with 3 products and sizes.
--
-- Safe to re-run: it deletes the demo shop first (and, with it, all of
-- the demo shop's products, customers and orders), then recreates it.
-- Run AFTER the migration, in the Supabase SQL Editor.
-- =====================================================================

delete from public.shops where slug = 'kefada-demo';

with new_shop as (
  insert into public.shops (name, slug, whatsapp_number, delivery_fee, plan)
  values ('Kefada Demo', 'kefada-demo', '+96170000000', 4.00, 'free')
  returning id
),
new_products as (
  insert into public.products (shop_id, name, description, price, sort_order)
  select new_shop.id, p.name, p.description, p.price, p.sort_order
  from new_shop,
  (values
    ('Cotton T-Shirt', 'Soft 100% cotton tee for everyday wear.',          12.00, 1),
    ('Denim Jacket',   'Classic denim jacket with button front.',          28.00, 2),
    ('Summer Dress',   'Light floral dress, perfect for warm days.',       22.00, 3)
  ) as p(name, description, price, sort_order)
  returning id, shop_id, name
)
insert into public.product_variants (shop_id, product_id, label, stock, price_override)
select new_products.shop_id, new_products.id, v.label, v.stock, v.price_override
from new_products
join (values
  ('Cotton T-Shirt', 'Size 2Y', 5,  null::numeric),
  ('Cotton T-Shirt', 'Size 4Y', 8,  null),
  ('Cotton T-Shirt', 'Size 6Y', 3,  null),
  ('Denim Jacket',   'Size 4Y', 4,  null),
  ('Denim Jacket',   'Size 6Y', 2,  null),
  ('Denim Jacket',   'Size 8Y', 2,  30.00),   -- bigger size costs more
  ('Summer Dress',   'Size 4Y', 6,  null),
  ('Summer Dress',   'Size 6Y', 0,  null)     -- out of stock, for testing
) as v(product_name, label, stock, price_override)
  on v.product_name = new_products.name;

-- Check the result:
select p.name as product, v.label as size, v.stock,
       coalesce(v.price_override, p.price) as price_usd
from public.products p
join public.shops s on s.id = p.shop_id
join public.product_variants v on v.product_id = p.id
where s.slug = 'kefada-demo'
order by p.sort_order, v.label;
