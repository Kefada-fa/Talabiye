-- =====================================================================
-- SECURITY TEST SCRIPT
--
-- Tries forbidden actions as:
--   * anon         — a visitor who is not logged in
--   * non-member   — a logged-in user who is NOT a member of any shop
-- plus checks on place_order's rules and on the database configuration.
-- Every row in the result should say PASS.
--
-- SAFE TO RUN: every test runs inside its own savepoint and is undone
-- right after, so no data is changed (even when a test fails).
--
-- Needs: both migrations + seed.sql (uses the "kefada-demo" shop).
-- How to run: Supabase → SQL Editor → New query → paste this whole
-- file → Run. Read the result table at the bottom.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Helper: runs ONE test and returns PASS / FAIL / SKIP.
--   p_role   'anon' | 'authenticated' | null (= run as you, the admin)
--   p_uid    the logged-in user's id (null for anon)
--   p_sql    the action to try
--   p_expect 'denied' → must fail with "permission denied" (42501)
--            'error'  → must fail with a message containing p_match
--            'empty'  → must succeed but see/change 0 rows
--            'rows'   → must succeed and return at least 1 row
--   p_setup  optional temporary test data, created as admin first
-- ---------------------------------------------------------------------
create or replace function pg_temp.sec_check(
  p_role   text,
  p_uid    uuid,
  p_sql    text,
  p_expect text,
  p_match  text default null,
  p_setup  text default null
) returns text
language plpgsql
as $$
declare
  v_stage  text := 'setup';
  v_count  bigint;
  v_found  text;
  v_result text;
begin
  begin
    -- Start every test from the demo shop exactly as seed.sql made it
    -- (your real orders/stock are only hidden inside this test, which is
    -- undone right after — nothing is really deleted).
    perform pg_temp.reset_demo();

    if p_setup is not null then
      execute p_setup;
    end if;

    v_stage := 'test';
    if p_role is not null then
      perform set_config('request.jwt.claims',
        json_build_object('sub', p_uid, 'role', p_role)::text, true);
      perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
      perform set_config('role', p_role, true);
    end if;

    execute p_sql;
    get diagnostics v_count = row_count;

    -- For admin checks that find problems, list what was found.
    if p_expect = 'empty' and v_count > 0 and p_role is null then
      execute format('select string_agg(t::text, '', '') from (%s) t', p_sql) into v_found;
    end if;

    v_result := case p_expect
      when 'empty' then case when v_count = 0 then 'PASS (0 rows)'
                             when v_found is not null then format('FAIL (found: %s)', v_found)
                             else format('FAIL (%s rows visible/changed!)', v_count) end
      when 'rows'  then case when v_count > 0 then 'PASS'
                             else 'FAIL (expected a result, got none)' end
      else 'FAIL (it was ALLOWED!)'
    end;

    -- Undo everything this test did (data, role, settings).
    raise exception using errcode = 'P0999';
  exception
    when sqlstate 'P0999' then
      null;
    when others then
      v_result := case
        when v_stage = 'setup' then 'SKIP (could not create test data: ' || sqlerrm || ')'
        when p_expect = 'denied' and sqlstate = '42501' then 'PASS (blocked: ' || sqlerrm || ')'
        when p_expect = 'error' and sqlerrm ilike '%' || p_match || '%' then 'PASS (rejected: ' || sqlerrm || ')'
        else 'FAIL (unexpected: ' || sqlerrm || ')'
      end;
  end;
  return v_result;
end;
$$;

drop table if exists pg_temp.sec_results;
create temp table sec_results (n serial, who text, test text, result text);

-- ---------------------------------------------------------------------
-- Small helpers used by the tests (temporary, gone when you close the tab)
-- ---------------------------------------------------------------------
-- Places an order through place_order (as whoever runs it). Defaults:
-- delivery to Beirut / Beirut, policy accepted, phone 70 123 456.
create or replace function pg_temp.order_with(
  p_items    jsonb,
  p_phone    text default '70123456',
  p_method   text default 'delivery',
  p_gov      text default 'Beirut',
  p_district text default 'Beirut',
  p_policy   boolean default true,
  p_shop     text default 'kefada-demo',
  p_street   text default 'Street 1',
  p_name     text default 'Test'
) returns jsonb
language sql
as $f$
  select public.place_order(p_shop, p_name, p_phone, p_method, p_gov, p_district,
    case when p_method = 'delivery' then 'Achrafieh' end, null, p_street, null, null,
    p_items, p_policy)
$f$;

-- Places a demo order of one product (and option) in kefada-demo.
create or replace function pg_temp.demo_order(
  p_product  text default 'Building Blocks Set',
  p_qty      integer default 1,
  p_phone    text default '70123456',
  p_variant  text default null,
  p_method   text default 'delivery',
  p_gov      text default 'Beirut',
  p_district text default 'Beirut',
  p_policy   boolean default true,
  p_street   text default 'Street 1'
) returns jsonb
language sql
as $f$
  select pg_temp.order_with(
    jsonb_build_array(jsonb_build_object(
      'product_id', (select id from public.products where name = p_product),
      'variant_id', (select v.id from public.product_variants v
                     join public.products p on p.id = v.product_id
                     where p.name = p_product and v.label = p_variant),
      'quantity', p_qty)),
    p_phone, p_method, p_gov, p_district, p_policy, 'kefada-demo', p_street)
$f$;

-- The most recently created order (looked up with admin rights).
create or replace function pg_temp.last_order_id()
returns uuid
language sql security definer
as $f$ select id from public.orders order by created_at desc, order_number desc limit 1 $f$;

-- Makes a test user a member (owner/staff) of the demo shop.
create or replace function pg_temp.add_member(p_uid uuid, p_role text)
returns void
language sql
as $f$
  insert into auth.users (id) values (p_uid) on conflict do nothing;
  insert into public.shop_members (shop_id, user_id, role)
  select id, p_uid, p_role from public.shops where slug = 'kefada-demo'
  on conflict (shop_id, user_id) do update set role = excluded.role;
$f$;

-- Puts the demo shop back exactly as seed.sql made it: no orders or
-- customers, seed stock/prices/costs/settings. Called at the start of EVERY
-- test inside its savepoint, so it is always undone afterwards — your real
-- data is never changed. This makes the tests pass even after you have
-- used the shop (placed orders, changed stock or settings).
create or replace function pg_temp.reset_demo()
returns void
language plpgsql
as $f$
declare
  v_shop uuid := (select id from public.shops where slug = 'kefada-demo');
begin
  if v_shop is null then
    return;
  end if;

  delete from public.orders    where shop_id = v_shop;   -- lines, history, outcomes, outbox follow
  delete from public.customers where shop_id = v_shop;
  delete from public.product_reviews where shop_id = v_shop;

  update public.shops
     set is_active = true, delivery_on = true, pickup_on = false, delivery_mode = 'governorate',
         delivery_fixed = 4, free_delivery_on = true, free_delivery_above = 60,
         policy_on = true, reviews_on = false, reviews_need_approval = true
   where id = v_shop;

  insert into public.shop_delivery_fees (shop_id, governorate, fee)
  select v_shop, g.name,
         case g.name when 'Beirut' then 3 when 'Mount Lebanon' then 4 when 'Akkar' then null else 5 end
  from public.lebanon_governorates g
  on conflict (shop_id, governorate) do update set fee = excluded.fee;

  update public.shop_private_settings set invoice_prefix = 'KF' where shop_id = v_shop;
  update public.shop_notification_settings
     set order_emails = array['shop@example.com'], email_enabled = true, push_enabled = false
   where shop_id = v_shop;

  update public.products p
     set is_active = true,
         price      = case p.name when 'Cotton T-Shirt' then 12 when 'Whey Protein 1kg' then 35
                                  when 'Building Blocks Set' then 25 when 'Kids Hoodie' then 22 else p.price end,
         sale_price = case p.name when 'Cotton T-Shirt' then 10 else null end,
         stock      = case p.name when 'Building Blocks Set' then 4 else null end,
         code       = case p.name when 'Cotton T-Shirt' then 'TS-1001' when 'Whey Protein 1kg' then 'WP-2001'
                                  when 'Building Blocks Set' then 'TY-3001' when 'Kids Hoodie' then 'HD-4001' else p.code end
   where p.shop_id = v_shop;

  update public.product_variants v
     set stock = case p.name || ':' || v.label
                   when 'Cotton T-Shirt:2Y' then 5  when 'Cotton T-Shirt:4Y' then 8  when 'Cotton T-Shirt:6Y' then 0
                   when 'Whey Protein 1kg:Chocolate' then 10 when 'Whey Protein 1kg:Vanilla' then 3
                   when 'Whey Protein 1kg:Cookies & Cream' then 2
                   when 'Kids Hoodie:Red / S' then 2  when 'Kids Hoodie:Red / M' then 0  when 'Kids Hoodie:Red / L' then 3
                   when 'Kids Hoodie:Navy / S' then 4 when 'Kids Hoodie:Navy / M' then 1 when 'Kids Hoodie:Navy / L' then 0
                   else v.stock end,
         price_override = case when p.name || ':' || v.label = 'Whey Protein 1kg:Cookies & Cream' then 38 else null end
    from public.products p
   where p.id = v.product_id and p.shop_id = v_shop;

  delete from public.product_costs where shop_id = v_shop;
  insert into public.product_costs (shop_id, product_id, wholesale_price)
  select v_shop, p.id, case p.name when 'Cotton T-Shirt' then 5 when 'Whey Protein 1kg' then 20 else 12 end
  from public.products p
  where p.shop_id = v_shop and p.name in ('Cotton T-Shirt', 'Whey Protein 1kg', 'Building Blocks Set');
end;
$f$;

-- Moves the most recent order to "paid" (as admin).
create or replace function pg_temp.pay_last_order()
returns void
language sql
as $f$
  update public.orders set status = 'pending' where id = pg_temp.last_order_id() and status = 'unconfirmed';
  update public.orders set status = 'paid'    where id = pg_temp.last_order_id();
$f$;

-- The secret review token of the most recent order.
create or replace function pg_temp.review_token()
returns text
language sql security definer
as $f$ select token from public.order_review_tokens where order_id = pg_temp.last_order_id() $f$;

-- Ids used below:
--   00000000-0000-4000-8000-000000000001  logged-in user, member of NO shop
--   00000000-0000-4000-8000-000000000002  temporary user, member of the demo shop

-- =====================================================================
-- A. ANON (not logged in) — reading private data
-- =====================================================================
insert into sec_results (who, test, result) values
('anon', 'read customers',
  pg_temp.sec_check('anon', null, 'select * from public.customers', 'denied')),
('anon', 'read orders',
  pg_temp.sec_check('anon', null, 'select * from public.orders', 'denied')),
('anon', 'read orders.confirm_token',
  pg_temp.sec_check('anon', null, 'select confirm_token from public.orders', 'denied')),
('anon', 'read order_items',
  pg_temp.sec_check('anon', null, 'select * from public.order_items', 'denied')),
('anon', 'read delivery_outcomes',
  pg_temp.sec_check('anon', null, 'select * from public.delivery_outcomes', 'denied')),
('anon', 'read shop_members',
  pg_temp.sec_check('anon', null, 'select * from public.shop_members', 'denied')),
('anon', 'read Vault salt (vault.decrypted_secrets)',
  pg_temp.sec_check('anon', null, 'select * from vault.decrypted_secrets', 'denied')),
('anon', 'read Vault (vault.secrets)',
  pg_temp.sec_check('anon', null, 'select * from vault.secrets', 'denied')),
('anon', 'call private.phone_hash()',
  pg_temp.sec_check('anon', null, $q$select private.phone_hash('70123456')$q$, 'denied')),
('anon', 'call get_phone_risk()',
  pg_temp.sec_check('anon', null, $q$select * from public.get_phone_risk('70123456')$q$, 'denied')),
('anon', 'see inactive shop',
  pg_temp.sec_check('anon', null, $q$select * from public.shops where slug = 'kefada-demo'$q$, 'empty',
    p_setup => $q$update public.shops set is_active = false where slug = 'kefada-demo'$q$)),
('anon', 'see inactive product',
  pg_temp.sec_check('anon', null, $q$select * from public.products where name = 'Building Blocks Set'$q$, 'empty',
    p_setup => $q$update public.products set is_active = false where name = 'Building Blocks Set'$q$));

-- =====================================================================
-- B. ANON — writing
-- =====================================================================
insert into sec_results (who, test, result) values
('anon', 'insert order directly',
  pg_temp.sec_check('anon', null, $q$insert into public.orders (shop_id, customer_id, delivery_address)
     select id, gen_random_uuid(), 'x' from public.shops limit 1$q$, 'denied')),
('anon', 'insert customer directly',
  pg_temp.sec_check('anon', null, $q$insert into public.customers (shop_id, name, phone)
     select id, 'x', '70123456' from public.shops limit 1$q$, 'denied')),
('anon', 'insert order item directly',
  pg_temp.sec_check('anon', null, $q$insert into public.order_items (shop_id, order_id, name, unit_price, list_price, quantity)
     select id, gen_random_uuid(), 'x', 0, 0, 1 from public.shops limit 1$q$, 'denied')),
('anon', 'insert product',
  pg_temp.sec_check('anon', null, $q$insert into public.products (shop_id, name, price)
     select id, 'x', 1 from public.shops limit 1$q$, 'denied')),
('anon', 'change product price',
  pg_temp.sec_check('anon', null, 'update public.products set price = 0', 'denied')),
('anon', 'change stock',
  pg_temp.sec_check('anon', null, 'update public.product_variants set stock = 999', 'denied')),
('anon', 'change shop plan',
  pg_temp.sec_check('anon', null, $q$update public.shops set plan = 'pro'$q$, 'denied')),
('anon', 'delete products',
  pg_temp.sec_check('anon', null, 'delete from public.products', 'denied')),
('anon', 'add shop category',
  pg_temp.sec_check('anon', null, $q$insert into public.shop_categories (slug, name) values ('hack', 'Hack')$q$, 'denied')),
('anon', 'join a shop as owner',
  pg_temp.sec_check('anon', null, $q$insert into public.shop_members (shop_id, user_id, role)
     select id, gen_random_uuid(), 'owner' from public.shops limit 1$q$, 'denied'));

-- =====================================================================
-- C. LOGGED-IN NON-MEMBER — reading
-- =====================================================================
insert into sec_results (who, test, result) values
('non-member', 'read customers',
  pg_temp.sec_check('authenticated', '00000000-0000-4000-8000-000000000001', 'select * from public.customers', 'empty',
    p_setup => $q$select pg_temp.demo_order()$q$)),
('non-member', 'read orders (and confirm_token)',
  pg_temp.sec_check('authenticated', '00000000-0000-4000-8000-000000000001', 'select confirm_token from public.orders', 'empty',
    p_setup => $q$select pg_temp.demo_order()$q$)),
('non-member', 'read order_items',
  pg_temp.sec_check('authenticated', '00000000-0000-4000-8000-000000000001', 'select * from public.order_items', 'empty',
    p_setup => $q$select pg_temp.demo_order()$q$)),
('non-member', 'read shop_members',
  pg_temp.sec_check('authenticated', '00000000-0000-4000-8000-000000000001', 'select * from public.shop_members', 'empty')),
('non-member', 'read delivery_outcomes',
  pg_temp.sec_check('authenticated', '00000000-0000-4000-8000-000000000001', 'select * from public.delivery_outcomes', 'denied')),
('non-member', 'read Vault salt',
  pg_temp.sec_check('authenticated', '00000000-0000-4000-8000-000000000001', 'select * from vault.decrypted_secrets', 'denied')),
('non-member', 'call private.phone_hash()',
  pg_temp.sec_check('authenticated', '00000000-0000-4000-8000-000000000001', $q$select private.phone_hash('70123456')$q$, 'denied')),
('non-member', 'call get_phone_risk()',
  pg_temp.sec_check('authenticated', '00000000-0000-4000-8000-000000000001', $q$select * from public.get_phone_risk('70123456')$q$, 'denied'));

-- =====================================================================
-- D. LOGGED-IN NON-MEMBER — writing
-- =====================================================================
insert into sec_results (who, test, result) values
('non-member', 'insert product into demo shop',
  pg_temp.sec_check('authenticated', '00000000-0000-4000-8000-000000000001', $q$insert into public.products (shop_id, name, price)
     select id, 'x', 1 from public.shops where slug = 'kefada-demo'$q$, 'denied')),
('non-member', 'insert order into demo shop',
  pg_temp.sec_check('authenticated', '00000000-0000-4000-8000-000000000001', $q$insert into public.orders (shop_id, customer_id, delivery_address)
     select id, gen_random_uuid(), 'x' from public.shops where slug = 'kefada-demo'$q$, 'denied')),
('non-member', 'make self owner of demo shop',
  pg_temp.sec_check('authenticated', '00000000-0000-4000-8000-000000000001', $q$insert into public.shop_members (shop_id, user_id, role)
     select id, '00000000-0000-4000-8000-000000000001', 'owner' from public.shops where slug = 'kefada-demo'$q$, 'denied')),
('non-member', 'change product prices',
  pg_temp.sec_check('authenticated', '00000000-0000-4000-8000-000000000001', 'update public.products set price = 0', 'empty')),
('non-member', 'change stock',
  pg_temp.sec_check('authenticated', '00000000-0000-4000-8000-000000000001', 'update public.product_variants set stock = 999', 'empty')),
('non-member', 'change shop settings',
  pg_temp.sec_check('authenticated', '00000000-0000-4000-8000-000000000001', 'update public.shops set delivery_fixed = 0', 'empty')),
('non-member', 'change shop plan',
  pg_temp.sec_check('authenticated', '00000000-0000-4000-8000-000000000001', $q$update public.shops set plan = 'pro'$q$, 'denied')),
('non-member', 'delete products',
  pg_temp.sec_check('authenticated', '00000000-0000-4000-8000-000000000001', 'delete from public.products', 'empty')),
('non-member', 'change an order status directly',
  pg_temp.sec_check('authenticated', '00000000-0000-4000-8000-000000000001', $q$update public.orders set status = 'pending'$q$, 'denied',
    p_setup => $q$select pg_temp.demo_order()$q$)),
('non-member', 'delete orders',
  pg_temp.sec_check('authenticated', '00000000-0000-4000-8000-000000000001', 'delete from public.orders', 'denied')),
('non-member', 'change order_number',
  pg_temp.sec_check('authenticated', '00000000-0000-4000-8000-000000000001', 'update public.orders set order_number = 1', 'denied'));

-- =====================================================================
-- E. get_phone_risk — only members of ACTIVE shops
-- =====================================================================
insert into sec_results (who, test, result) values
('member', 'member of ACTIVE shop CAN call get_phone_risk (control)',
  pg_temp.sec_check('authenticated', '00000000-0000-4000-8000-000000000002', $q$select * from public.get_phone_risk('70123456')$q$, 'rows',
    p_setup => $q$insert into auth.users (id) values ('00000000-0000-4000-8000-000000000002');
      insert into public.shop_members (shop_id, user_id, role)
      select id, '00000000-0000-4000-8000-000000000002', 'owner' from public.shops where slug = 'kefada-demo'$q$)),
('member', 'member of INACTIVE shop cannot call get_phone_risk',
  pg_temp.sec_check('authenticated', '00000000-0000-4000-8000-000000000002', $q$select * from public.get_phone_risk('70123456')$q$, 'denied',
    p_setup => $q$insert into auth.users (id) values ('00000000-0000-4000-8000-000000000002');
      insert into public.shop_members (shop_id, user_id, role)
      select id, '00000000-0000-4000-8000-000000000002', 'owner' from public.shops where slug = 'kefada-demo';
      update public.shops set is_active = false where slug = 'kefada-demo'$q$));

-- =====================================================================
-- F. place_order — SERVER ONLY, plus all its rules (run as the server)
-- =====================================================================
insert into sec_results (who, test, result) values
('anon', 'call place_order directly (must go through our checkout)',
  pg_temp.sec_check('anon', null, 'select pg_temp.demo_order()', 'denied')),
('owner', 'logged-in users cannot call place_order directly',
  pg_temp.sec_check('authenticated', '00000000-0000-4000-8000-000000000002', 'select pg_temp.demo_order()', 'denied',
    p_setup => $q$select pg_temp.add_member('00000000-0000-4000-8000-000000000002', 'owner')$q$)),
('server', 'valid order works (control)',
  pg_temp.sec_check('service_role', null,
    $q$select 1 from (select pg_temp.demo_order() r) x
       where (r ->> 'ok')::boolean and r ->> 'display_number' like 'KF-%' and not (r ? 'confirm_token')$q$, 'rows')),
('server', 'new website order: unconfirmed + history "Order placed"',
  pg_temp.sec_check('service_role', null,
    $q$select 1 from public.orders o join public.order_history h on h.order_id = o.id
       where o.id = pg_temp.last_order_id() and o.status = 'unconfirmed' and o.source = 'website'
         and h.text = 'Order placed on the website' and h.actor_label = 'Customer'$q$, 'rows',
    p_setup => $q$select pg_temp.demo_order()$q$)),
('server', 'unknown shop',
  pg_temp.sec_check('service_role', null,
    $q$select pg_temp.order_with('[]'::jsonb, p_shop => 'no-such-shop')$q$, 'error', 'Shop not found')),
('server', 'inactive shop',
  pg_temp.sec_check('service_role', null, 'select pg_temp.demo_order()', 'error', 'Shop not found',
    p_setup => $q$update public.shops set is_active = false where slug = 'kefada-demo'$q$)),
('server', 'inactive product (using its saved id)',
  pg_temp.sec_check('service_role', null, 'select pg_temp.demo_order()', 'error', 'no longer available',
    p_setup => $q$update public.products set is_active = false where name = 'Building Blocks Set'$q$)),
('server', 'product from ANOTHER shop',
  pg_temp.sec_check('service_role', null, $q$select pg_temp.demo_order('SecTest Product')$q$, 'error', 'no longer available',
    p_setup => $q$insert into public.shops (name, slug) values ('Security Test Shop', 'sec-test-shop');
      insert into public.products (shop_id, name, price) select id, 'SecTest Product', 5 from public.shops where slug = 'sec-test-shop'$q$)),
('server', 'option from ANOTHER shop',
  pg_temp.sec_check('service_role', null,
    $q$select pg_temp.order_with(jsonb_build_array(jsonb_build_object(
       'product_id', (select id from public.products where name = 'Cotton T-Shirt'),
       'variant_id', (select id from public.product_variants where label = 'SecTest Red'), 'quantity', 1)))$q$,
    'error', 'option in your cart is no longer available',
    p_setup => $q$insert into public.shops (name, slug) values ('Security Test Shop', 'sec-test-shop');
      insert into public.products (shop_id, name, price) select id, 'SecTest Product', 5 from public.shops where slug = 'sec-test-shop';
      insert into public.product_variants (shop_id, product_id, label, stock) select shop_id, id, 'SecTest Red', 5 from public.products where name = 'SecTest Product'$q$)),
('server', 'product with options but none chosen (uses the option''s own names)',
  pg_temp.sec_check('service_role', null, $q$select pg_temp.demo_order('Kids Hoodie')$q$, 'error', 'Please choose Color and Size for Kids Hoodie')),
('server', 'quantity 0',
  pg_temp.sec_check('service_role', null, $q$select pg_temp.demo_order(p_qty => 0)$q$, 'error', 'from 1 to 20')),
('server', 'quantity -1',
  pg_temp.sec_check('service_role', null, $q$select pg_temp.demo_order(p_qty => -1)$q$, 'error', 'from 1 to 20')),
('server', 'quantity 21',
  pg_temp.sec_check('service_role', null, $q$select pg_temp.demo_order(p_qty => 21)$q$, 'error', 'from 1 to 20')),
('server', 'quantity 1.5',
  pg_temp.sec_check('service_role', null,
    $q$select pg_temp.order_with(jsonb_build_array(jsonb_build_object('product_id', (select id from public.products where name = 'Building Blocks Set'), 'quantity', 1.5)))$q$,
    'error', 'from 1 to 20')),
('server', 'quantity as text "2"',
  pg_temp.sec_check('service_role', null,
    $q$select pg_temp.order_with(jsonb_build_array(jsonb_build_object('product_id', (select id from public.products where name = 'Building Blocks Set'), 'quantity', '2')))$q$,
    'error', 'from 1 to 20')),
('server', 'hide -5 inside a total (-5 + 10)',
  pg_temp.sec_check('service_role', null,
    $q$select pg_temp.order_with(jsonb_build_array(
       jsonb_build_object('product_id', (select id from public.products where name = 'Building Blocks Set'), 'quantity', -5),
       jsonb_build_object('product_id', (select id from public.products where name = 'Building Blocks Set'), 'quantity', 10)))$q$,
    'error', 'from 1 to 20')),
('server', 'same item twice, 15 + 10 = 25',
  pg_temp.sec_check('service_role', null,
    $q$select pg_temp.order_with(jsonb_build_array(
       jsonb_build_object('product_id', (select id from public.products where name = 'Whey Protein 1kg'),
                          'variant_id', (select id from public.product_variants where label = 'Chocolate'), 'quantity', 15),
       jsonb_build_object('product_id', (select id from public.products where name = 'Whey Protein 1kg'),
                          'variant_id', (select id from public.product_variants where label = 'Chocolate'), 'quantity', 10)))$q$,
    'error', 'at most 20 of each item')),
('server', 'more than 20 pieces in total (5 + 8 + 10)',
  pg_temp.sec_check('service_role', null,
    $q$select pg_temp.order_with(jsonb_build_array(
       jsonb_build_object('product_id', (select id from public.products where name = 'Cotton T-Shirt'),
                          'variant_id', (select id from public.product_variants where label = '2Y'), 'quantity', 5),
       jsonb_build_object('product_id', (select id from public.products where name = 'Cotton T-Shirt'),
                          'variant_id', (select id from public.product_variants where label = '4Y'), 'quantity', 8),
       jsonb_build_object('product_id', (select id from public.products where name = 'Whey Protein 1kg'),
                          'variant_id', (select id from public.product_variants where label = 'Chocolate'), 'quantity', 10)))$q$,
    'error', 'at most 20 pieces')),
('server', '31 cart entries',
  pg_temp.sec_check('service_role', null,
    $q$select pg_temp.order_with((select jsonb_agg(jsonb_build_object('product_id', (select id from public.products where name = 'Building Blocks Set'), 'quantity', 1))
       from generate_series(1, 31)))$q$, 'error', 'Too many items')),
('server', 'landline phone refused',
  pg_temp.sec_check('service_role', null, $q$select pg_temp.demo_order(p_phone => '01 123 456')$q$, 'error', 'valid Lebanese mobile')),
-- stock problems
('server', 'not enough stock → list with how many are left (no options)',
  pg_temp.sec_check('service_role', null,
    $q$select 1 from (select pg_temp.demo_order('Building Blocks Set', 5) r) x
       where r ->> 'ok' = 'false' and r -> 'stock_problems' -> 0 ->> 'available' = '4'
         and r -> 'stock_problems' -> 0 ->> 'requested' = '5'$q$, 'rows')),
('server', 'not enough stock → message uses the option''s own name',
  pg_temp.sec_check('service_role', null,
    $q$select 1 from (select pg_temp.demo_order('Whey Protein 1kg', 4, p_variant => 'Vanilla') r) x
       where r ->> 'ok' = 'false' and r -> 'stock_problems' -> 0 ->> 'option' = 'Flavor: Vanilla'
         and r ->> 'message' like '%Not enough stock for Whey Protein 1kg (Flavor: Vanilla): only 3 left%'$q$, 'rows')),
('server', 'sold-out combination of 2 options → listed as sold out',
  pg_temp.sec_check('service_role', null,
    $q$select 1 from (select pg_temp.demo_order('Kids Hoodie', 1, p_variant => 'Red / M') r) x
       where r ->> 'ok' = 'false' and r -> 'stock_problems' -> 0 ->> 'option' = 'Color: Red / Size: M'
         and r ->> 'message' like '%sold out%'$q$, 'rows')),
('server', 'stock problem saves NOTHING',
  pg_temp.sec_check('service_role', null,
    $q$select pg_temp.demo_order('Building Blocks Set', 5);
       select 1 from public.orders where shop_id = (select id from public.shops where slug = 'kefada-demo')$q$, 'empty')),
('server', 'stock is held when the order is placed (2 options)',
  pg_temp.sec_check('service_role', null,
    $q$select pg_temp.demo_order('Kids Hoodie', 2, p_variant => 'Navy / S');
       select 1 from public.product_variants where label = 'Navy / S' and stock = 2$q$, 'rows')),
-- prices
('server', 'sale price used; list price kept',
  pg_temp.sec_check('service_role', null,
    $q$select 1 from (select pg_temp.demo_order('Cotton T-Shirt', 2, p_variant => '2Y') r) x
       where (r -> 'items' -> 0 ->> 'unit_price')::numeric = 10 and (r -> 'items' -> 0 ->> 'list_price')::numeric = 12
         and (r ->> 'subtotal')::numeric = 20$q$, 'rows')),
('server', 'option''s own price wins over the sale price',
  pg_temp.sec_check('service_role', null,
    $q$select 1 from (select pg_temp.demo_order('Whey Protein 1kg', 1, p_variant => 'Cookies & Cream') r) x
       where (r -> 'items' -> 0 ->> 'unit_price')::numeric = 38$q$, 'rows',
    p_setup => $q$update public.products set sale_price = 30 where name = 'Whey Protein 1kg'$q$)),
('server', 'line keeps code, option label and cost',
  pg_temp.sec_check('service_role', null,
    $q$select 1 from public.order_items where order_id = pg_temp.last_order_id()
       and code = 'WP-2001' and option_label = 'Flavor: Chocolate' and cost = 20$q$, 'rows',
    p_setup => $q$select pg_temp.demo_order('Whey Protein 1kg', 1, p_variant => 'Chocolate')$q$)),
-- delivery fee (decided by the database)
('server', 'delivery to Beirut costs $3',
  pg_temp.sec_check('service_role', null,
    $q$select 1 from (select pg_temp.demo_order() r) x where (r ->> 'delivery_fee')::numeric = 3 and (r ->> 'total')::numeric = 28$q$, 'rows')),
('server', 'delivery to Mount Lebanon / Matn costs $4',
  pg_temp.sec_check('service_role', null,
    $q$select 1 from (select pg_temp.demo_order(p_gov => 'Mount Lebanon', p_district => 'Matn') r) x where (r ->> 'delivery_fee')::numeric = 4$q$, 'rows')),
('server', 'delivery to North / Tripoli costs $5',
  pg_temp.sec_check('service_role', null,
    $q$select 1 from (select pg_temp.demo_order(p_gov => 'North', p_district => 'Tripoli') r) x where (r ->> 'delivery_fee')::numeric = 5$q$, 'rows')),
('server', 'no delivery to Akkar',
  pg_temp.sec_check('service_role', null,
    $q$select pg_temp.demo_order(p_gov => 'Akkar', p_district => 'Akkar')$q$, 'error', 'does not deliver to Akkar')),
('server', 'free delivery at $60 or more',
  pg_temp.sec_check('service_role', null,
    $q$select 1 from (select pg_temp.demo_order('Whey Protein 1kg', 2, p_variant => 'Chocolate') r) x
       where (r ->> 'delivery_fee')::numeric = 0 and (r ->> 'free_delivery')::boolean and (r ->> 'total')::numeric = 70$q$, 'rows')),
('server', 'pickup ON: no fee, no address needed (control)',
  pg_temp.sec_check('service_role', null,
    $q$select 1 from (select pg_temp.demo_order(p_method => 'pickup', p_gov => null, p_district => null) r) x
       where (r ->> 'delivery_fee')::numeric = 0 and (r ->> 'total')::numeric = 25$q$, 'rows',
    p_setup => $q$update public.shops set pickup_on = true where slug = 'kefada-demo'$q$)),
('server', 'pickup OFF (the default): pickup refused',
  pg_temp.sec_check('service_role', null,
    $q$select pg_temp.demo_order(p_method => 'pickup', p_gov => null, p_district => null)$q$, 'error', 'does not offer pickup')),
('database', 'new shops are delivery-only by default',
  pg_temp.sec_check(null, null,
    $q$insert into public.shops (name, slug) values ('Default Shop', 'default-shop');
       select 1 from public.shops where slug = 'default-shop' and delivery_on and not pickup_on$q$, 'rows')),
('database', 'a shop cannot turn off BOTH delivery and pickup',
  pg_temp.sec_check(null, null,
    $q$update public.shops set delivery_on = false, pickup_on = false where slug = 'kefada-demo'$q$, 'error', 'shops_delivery_or_pickup')),
('owner', 'owner CAN turn pickup on (control)',
  pg_temp.sec_check('authenticated', '00000000-0000-4000-8000-000000000002',
    $q$update public.shops set pickup_on = true where slug = 'kefada-demo' returning id$q$, 'rows',
    p_setup => $q$select pg_temp.add_member('00000000-0000-4000-8000-000000000002', 'owner')$q$)),
('staff', 'staff cannot change the pickup setting',
  pg_temp.sec_check('authenticated', '00000000-0000-4000-8000-000000000003',
    $q$update public.shops set pickup_on = true where slug = 'kefada-demo'$q$, 'empty',
    p_setup => $q$select pg_temp.add_member('00000000-0000-4000-8000-000000000003', 'staff')$q$)),
('anon', 'change the pickup setting',
  pg_temp.sec_check('anon', null, 'update public.shops set pickup_on = true', 'denied')),
('server', 'fixed delivery fee mode uses the shop''s fixed fee',
  pg_temp.sec_check('service_role', null,
    $q$select 1 from (select pg_temp.demo_order(p_gov => 'Akkar', p_district => 'Akkar') r) x where (r ->> 'delivery_fee')::numeric = 7$q$, 'rows',
    p_setup => $q$update public.shops set delivery_mode = 'fixed', delivery_fixed = 7 where slug = 'kefada-demo'$q$)),
('server', 'delivery turned off → must choose pickup',
  pg_temp.sec_check('service_role', null, 'select pg_temp.demo_order()', 'error', 'does not deliver at the moment',
    p_setup => $q$update public.shops set pickup_on = true, delivery_on = false where slug = 'kefada-demo'$q$)),
('server', 'district must belong to the governorate',
  pg_temp.sec_check('service_role', null,
    $q$select pg_temp.demo_order(p_gov => 'Beirut', p_district => 'Tripoli')$q$, 'error', 'Please choose a district in Beirut')),
('server', 'delivery needs a street',
  pg_temp.sec_check('service_role', null,
    $q$select pg_temp.demo_order(p_street => '  ')$q$, 'error', 'Please enter your street')),
-- policy
('server', 'policy on: must be accepted',
  pg_temp.sec_check('service_role', null, $q$select pg_temp.demo_order(p_policy => false)$q$, 'error', 'accept the shop''s policy')),
('server', 'policy OFF: no agreement needed (control)',
  pg_temp.sec_check('service_role', null,
    $q$select 1 from (select pg_temp.demo_order(p_policy => false) r) x where (r ->> 'ok')::boolean$q$, 'rows',
    p_setup => $q$update public.shops set policy_on = false where slug = 'kefada-demo'$q$)),
-- spam limits (per shop)
('server', 'max 3 unconfirmed orders per phone per shop',
  pg_temp.sec_check('service_role', null, 'select pg_temp.demo_order()', 'error', 'waiting for confirmation',
    p_setup => $q$select pg_temp.demo_order(); select pg_temp.demo_order(); select pg_temp.demo_order()$q$)),
('server', 'max 4 orders per phone per shop in 24 hours',
  pg_temp.sec_check('service_role', null, $q$select pg_temp.demo_order('Whey Protein 1kg', 1, p_variant => 'Chocolate')$q$, 'error', 'limit of 4 orders in 24 hours',
    p_setup => $q$select pg_temp.demo_order(); select pg_temp.demo_order();
      update public.orders set status = 'pending';
      select pg_temp.demo_order(); select pg_temp.demo_order()$q$)),
('server', 'the 24h limit is PER SHOP: same phone can order in another shop (control)',
  pg_temp.sec_check('service_role', null,
    $q$select 1 from (select pg_temp.demo_order() r) x where (r ->> 'ok')::boolean$q$, 'rows',
    p_setup => $q$insert into public.shops (name, slug, delivery_fixed) values ('Other Shop', 'other-shop', 2);
      insert into public.products (shop_id, name, price) select id, 'Mug', 9 from public.shops where slug = 'other-shop';
      select pg_temp.order_with(jsonb_build_array(jsonb_build_object('product_id', (select id from public.products where name = 'Mug'), 'quantity', 1)), p_shop => 'other-shop') from generate_series(1, 3);
      update public.orders set status = 'pending' where shop_id = (select id from public.shops where slug = 'other-shop');
      select pg_temp.order_with(jsonb_build_array(jsonb_build_object('product_id', (select id from public.products where name = 'Mug'), 'quantity', 1)), p_shop => 'other-shop');
      select 1 where (select count(*) from public.orders where shop_id = (select id from public.shops where slug = 'other-shop')) = 4$q$)),
('server', 'max 25 website orders per hour per shop',
  pg_temp.sec_check('service_role', null, $q$select pg_temp.demo_order(p_phone => '81 999 999')$q$, 'error', 'receiving a lot of orders',
    p_setup => $q$update public.products set stock = null where name = 'Building Blocks Set';
      select pg_temp.demo_order(p_phone => '70' || lpad(i::text, 6, '0')) from generate_series(1, 25) i$q$)),
('server', 'existing customer is not renamed by a new order',
  pg_temp.sec_check(null, null, $q$select 1 from public.customers where phone = '+96170999888' and name = 'Test'$q$, 'rows',
    p_setup => $q$select pg_temp.demo_order(p_phone => '70999888');
      select pg_temp.order_with(jsonb_build_array(jsonb_build_object('product_id', (select id from public.products where name = 'Building Blocks Set'), 'quantity', 1)),
                                p_phone => '70 999 888', p_name => 'Someone Else')$q$));

-- =====================================================================
-- H. NOTIFICATIONS (settings, push tokens, outbox)
-- Temporary users:  …0002 = OWNER of the demo shop
--                   …0003 = STAFF of the demo shop
-- =====================================================================
insert into sec_results (who, test, result) values
-- anon
('anon', 'read shop_notification_settings',
  pg_temp.sec_check('anon', null, 'select * from public.shop_notification_settings', 'denied')),
('anon', 'read device_push_tokens',
  pg_temp.sec_check('anon', null, 'select * from public.device_push_tokens', 'denied')),
('anon', 'read notification_outbox',
  pg_temp.sec_check('anon', null, 'select * from public.notification_outbox', 'denied')),
('anon', 'add a row to notification_outbox',
  pg_temp.sec_check('anon', null, $q$insert into public.notification_outbox (shop_id, order_id, event_type, channel, recipient)
     select shop_id, id, 'order.created', 'email', 'x@example.com' from public.orders limit 1$q$, 'denied')),
('anon', 'call claim_notifications()',
  pg_temp.sec_check('anon', null, 'select * from public.claim_notifications(10)', 'denied')),
-- non-member
('non-member', 'read notification settings',
  pg_temp.sec_check('authenticated', '00000000-0000-4000-8000-000000000001',
    'select * from public.shop_notification_settings', 'empty')),
('non-member', 'change notification emails',
  pg_temp.sec_check('authenticated', '00000000-0000-4000-8000-000000000001',
    $q$update public.shop_notification_settings set order_emails = array['hacker@example.com']$q$, 'empty')),
('non-member', 'read notification_outbox',
  pg_temp.sec_check('authenticated', '00000000-0000-4000-8000-000000000001',
    'select * from public.notification_outbox', 'empty',
    p_setup => $q$select pg_temp.demo_order()$q$)),
('non-member', 'read other users'' push tokens',
  pg_temp.sec_check('authenticated', '00000000-0000-4000-8000-000000000001',
    'select * from public.device_push_tokens', 'empty',
    p_setup => $q$insert into auth.users (id) values ('00000000-0000-4000-8000-000000000002');
      insert into public.shop_members (shop_id, user_id, role)
      select id, '00000000-0000-4000-8000-000000000002', 'owner' from public.shops where slug = 'kefada-demo';
      insert into public.device_push_tokens (user_id, shop_id, platform, token)
      select '00000000-0000-4000-8000-000000000002', id, 'web', 'tok-owner' from public.shops where slug = 'kefada-demo'$q$)),
('non-member', 'register a push token for the demo shop',
  pg_temp.sec_check('authenticated', '00000000-0000-4000-8000-000000000001',
    $q$insert into public.device_push_tokens (shop_id, platform, token)
       select id, 'web', 'tok-hacker' from public.shops where slug = 'kefada-demo'$q$, 'denied')),
('non-member', 'call claim_notifications()',
  pg_temp.sec_check('authenticated', '00000000-0000-4000-8000-000000000001',
    'select * from public.claim_notifications(10)', 'denied')),
('non-member', 'add a row to notification_outbox',
  pg_temp.sec_check('authenticated', '00000000-0000-4000-8000-000000000001',
    $q$insert into public.notification_outbox (shop_id, order_id, event_type, channel, recipient)
       values (gen_random_uuid(), gen_random_uuid(), 'order.created', 'email', 'x@example.com')$q$, 'denied')),
-- owner / staff
('owner', 'owner CAN read own notification settings (control)',
  pg_temp.sec_check('authenticated', '00000000-0000-4000-8000-000000000002',
    'select * from public.shop_notification_settings', 'rows',
    p_setup => $q$insert into auth.users (id) values ('00000000-0000-4000-8000-000000000002');
      insert into public.shop_members (shop_id, user_id, role)
      select id, '00000000-0000-4000-8000-000000000002', 'owner' from public.shops where slug = 'kefada-demo'$q$)),
('owner', 'owner CAN change own notification emails (control)',
  pg_temp.sec_check('authenticated', '00000000-0000-4000-8000-000000000002',
    $q$update public.shop_notification_settings set order_emails = array['me@example.com'] returning id$q$, 'rows',
    p_setup => $q$insert into auth.users (id) values ('00000000-0000-4000-8000-000000000002');
      insert into public.shop_members (shop_id, user_id, role)
      select id, '00000000-0000-4000-8000-000000000002', 'owner' from public.shops where slug = 'kefada-demo'$q$)),
('owner', 'invalid email address is rejected',
  pg_temp.sec_check('authenticated', '00000000-0000-4000-8000-000000000002',
    $q$update public.shop_notification_settings set order_emails = array['not an email']$q$, 'error', 'check constraint',
    p_setup => $q$insert into auth.users (id) values ('00000000-0000-4000-8000-000000000002');
      insert into public.shop_members (shop_id, user_id, role)
      select id, '00000000-0000-4000-8000-000000000002', 'owner' from public.shops where slug = 'kefada-demo'$q$)),
('owner', 'owner CAN read own shop''s outbox (control)',
  pg_temp.sec_check('authenticated', '00000000-0000-4000-8000-000000000002',
    'select * from public.notification_outbox', 'rows',
    p_setup => $q$insert into auth.users (id) values ('00000000-0000-4000-8000-000000000002');
      insert into public.shop_members (shop_id, user_id, role)
      select id, '00000000-0000-4000-8000-000000000002', 'owner' from public.shops where slug = 'kefada-demo';
      select pg_temp.demo_order()$q$)),
('owner', 'owner cannot mark outbox rows as sent',
  pg_temp.sec_check('authenticated', '00000000-0000-4000-8000-000000000002',
    $q$update public.notification_outbox set status = 'sent'$q$, 'denied',
    p_setup => $q$insert into auth.users (id) values ('00000000-0000-4000-8000-000000000002');
      insert into public.shop_members (shop_id, user_id, role)
      select id, '00000000-0000-4000-8000-000000000002', 'owner' from public.shops where slug = 'kefada-demo'$q$)),
('staff', 'staff cannot read notification settings',
  pg_temp.sec_check('authenticated', '00000000-0000-4000-8000-000000000003',
    'select * from public.shop_notification_settings', 'empty',
    p_setup => $q$insert into auth.users (id) values ('00000000-0000-4000-8000-000000000003');
      insert into public.shop_members (shop_id, user_id, role)
      select id, '00000000-0000-4000-8000-000000000003', 'staff' from public.shops where slug = 'kefada-demo'$q$)),
('staff', 'staff cannot read the owner''s push tokens',
  pg_temp.sec_check('authenticated', '00000000-0000-4000-8000-000000000003',
    'select * from public.device_push_tokens', 'empty',
    p_setup => $q$insert into auth.users (id) values ('00000000-0000-4000-8000-000000000002'), ('00000000-0000-4000-8000-000000000003');
      insert into public.shop_members (shop_id, user_id, role)
      select id, '00000000-0000-4000-8000-000000000002', 'owner' from public.shops where slug = 'kefada-demo';
      insert into public.shop_members (shop_id, user_id, role)
      select id, '00000000-0000-4000-8000-000000000003', 'staff' from public.shops where slug = 'kefada-demo';
      insert into public.device_push_tokens (user_id, shop_id, platform, token)
      select '00000000-0000-4000-8000-000000000002', id, 'web', 'tok-owner' from public.shops where slug = 'kefada-demo'$q$)),
('staff', 'staff CAN register own push token (control)',
  pg_temp.sec_check('authenticated', '00000000-0000-4000-8000-000000000003',
    $q$insert into public.device_push_tokens (shop_id, platform, token)
       select id, 'android', 'tok-staff' from public.shops where slug = 'kefada-demo' returning id$q$, 'rows',
    p_setup => $q$insert into auth.users (id) values ('00000000-0000-4000-8000-000000000003');
      insert into public.shop_members (shop_id, user_id, role)
      select id, '00000000-0000-4000-8000-000000000003', 'staff' from public.shops where slug = 'kefada-demo'$q$)),
-- the trigger itself
('database', 'new order automatically queues an email',
  pg_temp.sec_check(null, null,
    $q$select 1 from public.notification_outbox o join public.orders r on r.id = o.order_id
       where o.channel = 'email' and o.status = 'pending' and o.recipient = 'trigger-test@example.com'$q$, 'rows',
    p_setup => $q$update public.shop_notification_settings set order_emails = array['trigger-test@example.com'], email_enabled = true
        where shop_id = (select id from public.shops where slug = 'kefada-demo');
      select pg_temp.demo_order()$q$)),
('database', 'email turned off → no email queued',
  pg_temp.sec_check(null, null,
    $q$select 1 from public.notification_outbox o
       where o.shop_id = (select id from public.shops where slug = 'kefada-demo') and o.channel = 'email'$q$, 'empty',
    p_setup => $q$update public.shop_notification_settings set order_emails = array['trigger-test@example.com'], email_enabled = false
        where shop_id = (select id from public.shops where slug = 'kefada-demo');
      delete from public.notification_outbox where shop_id = (select id from public.shops where slug = 'kefada-demo');
      select pg_temp.demo_order()$q$)),
('server', 'server CAN claim queued notifications (control)',
  pg_temp.sec_check('service_role', null,
    $q$select 1 from public.claim_notifications(10) c where c.status = 'sending' and c.attempts = 1$q$, 'rows',
    p_setup => $q$update public.shop_notification_settings set order_emails = array['claim-test@example.com'], email_enabled = true
        where shop_id = (select id from public.shops where slug = 'kefada-demo');
      select pg_temp.demo_order()$q$)),
('server', 'place_order receipt has items but no confirm_token',
  pg_temp.sec_check('service_role', null,
    $q$select 1 from (select pg_temp.demo_order('Building Blocks Set', 2) r) x
       where jsonb_array_length(r -> 'items') = 1 and not (r ? 'confirm_token')
         and (r -> 'items' -> 0 ->> 'line_total')::numeric = 50$q$, 'rows'));

-- =====================================================================
-- I. CATALOG, SETTINGS, COSTS, MONEY (Step 6, migration 1)
-- =====================================================================
insert into sec_results (who, test, result) values
-- anon: private things
('anon', 'read product_costs',
  pg_temp.sec_check('anon', null, 'select * from public.product_costs', 'denied')),
('anon', 'read shop_private_settings',
  pg_temp.sec_check('anon', null, 'select * from public.shop_private_settings', 'denied')),
('anon', 'read money_entries',
  pg_temp.sec_check('anon', null, 'select * from public.money_entries', 'denied')),
('anon', 'add a money entry',
  pg_temp.sec_check('anon', null, $q$insert into public.money_entries (shop_id, kind, name, amount)
     select id, 'expense', 'x', 1 from public.shops limit 1$q$, 'denied')),
-- anon: public things
('anon', 'CAN read Lebanon districts (control)',
  pg_temp.sec_check('anon', null, 'select * from public.lebanon_districts', 'rows')),
('anon', 'CAN read delivery fees of an active shop (control)',
  pg_temp.sec_check('anon', null, 'select * from public.shop_delivery_fees', 'rows',
    p_setup => $q$insert into public.shop_delivery_fees (shop_id, governorate, fee)
      select id, 'Beirut', 3 from public.shops where slug = 'kefada-demo'
      on conflict (shop_id, governorate) do update set fee = excluded.fee$q$)),
('anon', 'see delivery fees of an INACTIVE shop',
  pg_temp.sec_check('anon', null, 'select * from public.shop_delivery_fees', 'empty',
    p_setup => $q$insert into public.shop_delivery_fees (shop_id, governorate, fee)
      select id, 'Beirut', 3 from public.shops where slug = 'kefada-demo'
      on conflict (shop_id, governorate) do update set fee = excluded.fee;
      update public.shops set is_active = false where slug = 'kefada-demo'$q$)),
('anon', 'CAN see photos of a visible product (control)',
  pg_temp.sec_check('anon', null, 'select * from public.product_photos', 'rows',
    p_setup => $q$insert into public.product_photos (shop_id, product_id, storage_path)
      select shop_id, id, 'demo/photo.jpg' from public.products where name = 'Building Blocks Set'$q$)),
('anon', 'see photos of a HIDDEN product',
  pg_temp.sec_check('anon', null, 'select * from public.product_photos', 'empty',
    p_setup => $q$insert into public.product_photos (shop_id, product_id, storage_path)
      select shop_id, id, 'demo/photo.jpg' from public.products where name = 'Building Blocks Set';
      update public.products set is_active = false where name = 'Building Blocks Set'$q$)),
('anon', 'see option types of a HIDDEN product',
  pg_temp.sec_check('anon', null, format('select * from public.product_option_types where product_id = %L',
      (select id from public.products where name = 'Whey Protein 1kg')), 'empty',
    p_setup => $q$insert into public.product_option_types (shop_id, product_id, position, name)
      select shop_id, id, 1, 'Flavor' from public.products where name = 'Whey Protein 1kg'
      on conflict (product_id, position) do nothing;
      update public.products set is_active = false where name = 'Whey Protein 1kg'$q$)),
('anon', 'change shop delivery settings',
  pg_temp.sec_check('anon', null, 'update public.shops set delivery_on = false', 'denied')),
-- logged-in non-member
('non-member', 'read product costs',
  pg_temp.sec_check('authenticated', '00000000-0000-4000-8000-000000000001', 'select * from public.product_costs', 'empty',
    p_setup => $q$insert into public.product_costs (shop_id, product_id, wholesale_price)
      select shop_id, id, 10 from public.products where name = 'Building Blocks Set'
      on conflict (product_id) do update set wholesale_price = excluded.wholesale_price$q$)),
('non-member', 'read private settings',
  pg_temp.sec_check('authenticated', '00000000-0000-4000-8000-000000000001', 'select * from public.shop_private_settings', 'empty')),
('non-member', 'read money entries',
  pg_temp.sec_check('authenticated', '00000000-0000-4000-8000-000000000001', 'select * from public.money_entries', 'empty',
    p_setup => $q$insert into public.money_entries (shop_id, kind, name, amount)
      select id, 'expense', 'Rent', 100 from public.shops where slug = 'kefada-demo'$q$)),
('non-member', 'add a money entry to the demo shop',
  pg_temp.sec_check('authenticated', '00000000-0000-4000-8000-000000000001', $q$insert into public.money_entries (shop_id, kind, name, amount)
     select id, 'money_withdrawn', 'x', 1 from public.shops where slug = 'kefada-demo'$q$, 'denied')),
('non-member', 'set a product cost in the demo shop',
  pg_temp.sec_check('authenticated', '00000000-0000-4000-8000-000000000001', $q$insert into public.product_costs (shop_id, product_id, wholesale_price)
     select shop_id, id, 1 from public.products where name = 'Building Blocks Set'$q$, 'denied')),
('non-member', 'change delivery fees',
  pg_temp.sec_check('authenticated', '00000000-0000-4000-8000-000000000001', 'update public.shop_delivery_fees set fee = 0', 'empty',
    p_setup => $q$insert into public.shop_delivery_fees (shop_id, governorate, fee)
      select id, 'Beirut', 3 from public.shops where slug = 'kefada-demo'
      on conflict (shop_id, governorate) do update set fee = excluded.fee$q$)),
('non-member', 'change shop policy / delivery settings',
  pg_temp.sec_check('authenticated', '00000000-0000-4000-8000-000000000001', $q$update public.shops set policy_on = false, delivery_on = false$q$, 'empty')),
('non-member', 'change the invoice prefix',
  pg_temp.sec_check('authenticated', '00000000-0000-4000-8000-000000000001', $q$update public.shop_private_settings set invoice_prefix = 'HACK'$q$, 'empty')),
-- staff / owner
('staff', 'staff CAN read product costs (control)',
  pg_temp.sec_check('authenticated', '00000000-0000-4000-8000-000000000003', 'select * from public.product_costs', 'rows',
    p_setup => $q$insert into auth.users (id) values ('00000000-0000-4000-8000-000000000003');
      insert into public.shop_members (shop_id, user_id, role)
      select id, '00000000-0000-4000-8000-000000000003', 'staff' from public.shops where slug = 'kefada-demo'$q$)),
('staff', 'staff cannot change the invoice prefix',
  pg_temp.sec_check('authenticated', '00000000-0000-4000-8000-000000000003', $q$update public.shop_private_settings set invoice_prefix = 'ST'$q$, 'empty',
    p_setup => $q$insert into auth.users (id) values ('00000000-0000-4000-8000-000000000003');
      insert into public.shop_members (shop_id, user_id, role)
      select id, '00000000-0000-4000-8000-000000000003', 'staff' from public.shops where slug = 'kefada-demo'$q$)),
('owner', 'owner CAN change the invoice prefix (control)',
  pg_temp.sec_check('authenticated', '00000000-0000-4000-8000-000000000002', $q$update public.shop_private_settings set invoice_prefix = 'KF' returning id$q$, 'rows',
    p_setup => $q$insert into auth.users (id) values ('00000000-0000-4000-8000-000000000002');
      insert into public.shop_members (shop_id, user_id, role)
      select id, '00000000-0000-4000-8000-000000000002', 'owner' from public.shops where slug = 'kefada-demo'$q$)),
('owner', 'invalid invoice prefix refused',
  pg_temp.sec_check('authenticated', '00000000-0000-4000-8000-000000000002', $q$update public.shop_private_settings set invoice_prefix = 'kf-1'$q$, 'error', 'check constraint',
    p_setup => $q$insert into auth.users (id) values ('00000000-0000-4000-8000-000000000002');
      insert into public.shop_members (shop_id, user_id, role)
      select id, '00000000-0000-4000-8000-000000000002', 'owner' from public.shops where slug = 'kefada-demo'$q$)),
-- product rules
('database', 'item code must be unique within a shop',
  pg_temp.sec_check(null, null, $q$update public.products set code = 'ABC-1' where name in ('Building Blocks Set', 'Cotton T-Shirt')$q$, 'error', 'duplicate key')),
('database', 'same item code allowed in another shop (control)',
  pg_temp.sec_check(null, null, $q$select 1 from public.products where code = 'abc-1'$q$, 'rows',
    p_setup => $q$update public.products set code = 'ABC-1' where name = 'Building Blocks Set';
      insert into public.shops (name, slug) values ('Code Test Shop', 'code-test-shop');
      insert into public.products (shop_id, name, price, code) select id, 'Other', 5, 'abc-1' from public.shops where slug = 'code-test-shop'$q$)),
('database', 'sale price must be lower than the price',
  pg_temp.sec_check(null, null, $q$update public.products set sale_price = price where name = 'Building Blocks Set'$q$, 'error', 'products_sale_price_check')),
('database', 'item code with spaces refused',
  pg_temp.sec_check(null, null, $q$update public.products set code = 'AB 12' where name = 'Building Blocks Set'$q$, 'error', 'check constraint')),
-- Lebanese mobile numbers
('phone', 'all valid mobile formats accepted (03/70/71/76/78/79/81)',
  pg_temp.sec_check(null, null, $q$select 1 where (select bool_and(private.normalize_lb_phone(i) = o) from (values
      ('03 123 456', '+9613123456'), ('3123456', '+9613123456'), ('+961 3 123 456', '+9613123456'),
      ('00961 3 123456', '+9613123456'), ('961-3-123456', '+9613123456'), ('+961 03 123 456', '+9613123456'),
      ('70 123 456', '+96170123456'), ('+96170123456', '+96170123456'), ('0096170123456', '+96170123456'),
      ('070 123 456', '+96170123456'), ('71-123-456', '+96171123456'), ('76123456', '+96176123456'),
      ('78 123 456', '+96178123456'), ('961 79 123 456', '+96179123456'), ('81 123 456', '+96181123456')
    ) as v(i, o))$q$, 'rows')),
('phone', 'landline 01 123 456 refused',
  pg_temp.sec_check(null, null, $q$select private.normalize_lb_phone('01 123 456')$q$, 'error', 'valid Lebanese mobile')),
('phone', 'landline 04 123 456 refused',
  pg_temp.sec_check(null, null, $q$select private.normalize_lb_phone('04 123 456')$q$, 'error', 'valid Lebanese mobile')),
('phone', 'landline +961 9 123 456 refused',
  pg_temp.sec_check(null, null, $q$select private.normalize_lb_phone('+961 9 123 456')$q$, 'error', 'valid Lebanese mobile')),
('phone', 'unknown mobile prefix 72 refused',
  pg_temp.sec_check(null, null, $q$select private.normalize_lb_phone('72 123 456')$q$, 'error', 'valid Lebanese mobile')),
('phone', 'too short (03 123 45) refused',
  pg_temp.sec_check(null, null, $q$select private.normalize_lb_phone('03 123 45')$q$, 'error', 'valid Lebanese mobile')),
('phone', 'too long (70 123 4567) refused',
  pg_temp.sec_check(null, null, $q$select private.normalize_lb_phone('70 123 4567')$q$, 'error', 'valid Lebanese mobile'));

-- =====================================================================
-- J. INVOICES: statuses, stock, history, costs, reviews (Step 6, migration 2)
-- Users: …0001 = logged in, no shop · …0002 = OWNER · …0003 = STAFF
-- =====================================================================
insert into sec_results (who, test, result) values
-- status changes through the functions
('owner', 'owner CAN confirm an unconfirmed order (control)',
  pg_temp.sec_check('authenticated', '00000000-0000-4000-8000-000000000002',
    'select public.confirm_order(pg_temp.last_order_id())', 'rows',
    p_setup => $q$select pg_temp.add_member('00000000-0000-4000-8000-000000000002', 'owner'); select pg_temp.demo_order()$q$)),
('staff', 'staff CAN confirm an order (control)',
  pg_temp.sec_check('authenticated', '00000000-0000-4000-8000-000000000003',
    'select public.confirm_order(pg_temp.last_order_id())', 'rows',
    p_setup => $q$select pg_temp.add_member('00000000-0000-4000-8000-000000000003', 'staff'); select pg_temp.demo_order()$q$)),
('non-member', 'confirm another shop''s order',
  pg_temp.sec_check('authenticated', '00000000-0000-4000-8000-000000000001',
    'select public.confirm_order(pg_temp.last_order_id())', 'denied',
    p_setup => $q$select pg_temp.demo_order()$q$)),
('non-member', 'cancel another shop''s order',
  pg_temp.sec_check('authenticated', '00000000-0000-4000-8000-000000000001',
    $q$select public.cancel_order(pg_temp.last_order_id(), 'x')$q$, 'denied',
    p_setup => $q$select pg_temp.demo_order()$q$)),
('anon', 'call confirm_order',
  pg_temp.sec_check('anon', null, 'select public.confirm_order(pg_temp.last_order_id())', 'denied',
    p_setup => $q$select pg_temp.demo_order()$q$)),
('owner', 'owner cannot change status directly (only via functions)',
  pg_temp.sec_check('authenticated', '00000000-0000-4000-8000-000000000002',
    $q$update public.orders set status = 'pending'$q$, 'denied',
    p_setup => $q$select pg_temp.add_member('00000000-0000-4000-8000-000000000002', 'owner'); select pg_temp.demo_order()$q$)),
('owner', 'owner cannot change totals directly',
  pg_temp.sec_check('authenticated', '00000000-0000-4000-8000-000000000002',
    'update public.orders set total = 0, subtotal = 0', 'denied',
    p_setup => $q$select pg_temp.add_member('00000000-0000-4000-8000-000000000002', 'owner'); select pg_temp.demo_order()$q$)),
('owner', 'owner CAN edit order notes (control)',
  pg_temp.sec_check('authenticated', '00000000-0000-4000-8000-000000000002',
    $q$update public.orders set notes = 'Call before delivery' returning id$q$, 'rows',
    p_setup => $q$select pg_temp.add_member('00000000-0000-4000-8000-000000000002', 'owner'); select pg_temp.demo_order()$q$)),
('owner', 'owner cannot edit order lines (cost/price) directly',
  pg_temp.sec_check('authenticated', '00000000-0000-4000-8000-000000000002',
    'update public.order_items set cost = 0', 'denied',
    p_setup => $q$select pg_temp.add_member('00000000-0000-4000-8000-000000000002', 'owner'); select pg_temp.demo_order()$q$)),
-- only valid moves
('owner', 'confirm an order that is already pending',
  pg_temp.sec_check('authenticated', '00000000-0000-4000-8000-000000000002',
    'select public.confirm_order(pg_temp.last_order_id()); select public.confirm_order(pg_temp.last_order_id())', 'error', 'Only unconfirmed',
    p_setup => $q$select pg_temp.add_member('00000000-0000-4000-8000-000000000002', 'owner'); select pg_temp.demo_order()$q$)),
('owner', 'mark an unconfirmed order as paid',
  pg_temp.sec_check('authenticated', '00000000-0000-4000-8000-000000000002',
    'select public.mark_paid(pg_temp.last_order_id())', 'error', 'Only pending',
    p_setup => $q$select pg_temp.add_member('00000000-0000-4000-8000-000000000002', 'owner'); select pg_temp.demo_order()$q$)),
('owner', 'cancel a PAID order',
  pg_temp.sec_check('authenticated', '00000000-0000-4000-8000-000000000002',
    $q$select public.cancel_order(pg_temp.last_order_id(), 'Changed mind')$q$, 'error', 'can no longer be cancelled',
    p_setup => $q$select pg_temp.add_member('00000000-0000-4000-8000-000000000002', 'owner'); select pg_temp.demo_order(); select pg_temp.pay_last_order()$q$)),
('owner', 'cancel without a reason',
  pg_temp.sec_check('authenticated', '00000000-0000-4000-8000-000000000002',
    $q$select public.cancel_order(pg_temp.last_order_id(), '  ')$q$, 'error', 'give a reason',
    p_setup => $q$select pg_temp.add_member('00000000-0000-4000-8000-000000000002', 'owner'); select pg_temp.demo_order()$q$)),
('owner', 'confirm a CANCELLED order',
  pg_temp.sec_check('authenticated', '00000000-0000-4000-8000-000000000002',
    $q$select public.cancel_order(pg_temp.last_order_id(), 'Out of stock'); select public.confirm_order(pg_temp.last_order_id())$q$, 'error', 'Only unconfirmed',
    p_setup => $q$select pg_temp.add_member('00000000-0000-4000-8000-000000000002', 'owner'); select pg_temp.demo_order()$q$)),
('owner', 'refuse an UNCONFIRMED order (must be pending)',
  pg_temp.sec_check('authenticated', '00000000-0000-4000-8000-000000000002',
    'select public.mark_refused(pg_temp.last_order_id())', 'error', 'Only pending',
    p_setup => $q$select pg_temp.add_member('00000000-0000-4000-8000-000000000002', 'owner'); select pg_temp.demo_order()$q$)),
('database', 'guard: cancelled → pending refused even for admin',
  pg_temp.sec_check(null, null,
    $q$update public.orders set status = 'pending' where id = pg_temp.last_order_id()$q$, 'error', 'cannot go from cancelled to pending',
    p_setup => $q$select pg_temp.demo_order(); update public.orders set status = 'cancelled', cancel_reason = 'x' where id = pg_temp.last_order_id()$q$)),
('database', 'guard: paid → pending refused without edit_order',
  pg_temp.sec_check(null, null,
    $q$update public.orders set status = 'pending' where id = pg_temp.last_order_id()$q$, 'error', 'cannot go from paid to pending',
    p_setup => $q$select pg_temp.demo_order(); select pg_temp.pay_last_order()$q$)),
('database', 'guard: paid → pending allowed for future edit_order (control)',
  pg_temp.sec_check(null, null,
    $q$select set_config('app.reopen_paid_order', 'on', true);
       update public.orders set status = 'pending' where id = pg_temp.last_order_id() returning id$q$, 'rows',
    p_setup => $q$select pg_temp.demo_order(); select pg_temp.pay_last_order()$q$)),
('database', 'cancelled order needs a reason',
  pg_temp.sec_check(null, null,
    $q$update public.orders set status = 'cancelled' where id = pg_temp.last_order_id()$q$, 'error', 'orders_cancel_reason_required',
    p_setup => $q$select pg_temp.demo_order()$q$)),
-- manual invoices
('database', 'manual invoice CAN start as pending (control)',
  pg_temp.sec_check(null, null,
    $q$insert into public.orders (shop_id, customer_id, source, status)
       select shop_id, id, 'manual', 'pending' from public.customers limit 1 returning id$q$, 'rows',
    p_setup => $q$select pg_temp.demo_order()$q$)),
('database', 'manual invoice cannot start as unconfirmed',
  pg_temp.sec_check(null, null,
    $q$insert into public.orders (shop_id, customer_id, source, status)
       select shop_id, id, 'manual', 'unconfirmed' from public.customers limit 1$q$, 'error', 'must start as pending',
    p_setup => $q$select pg_temp.demo_order()$q$)),
('database', 'website order cannot start as pending',
  pg_temp.sec_check(null, null,
    $q$insert into public.orders (shop_id, customer_id, source, status)
       select shop_id, id, 'website', 'pending' from public.customers limit 1$q$, 'error', 'must start as unconfirmed',
    p_setup => $q$select pg_temp.demo_order()$q$)),
('database', 'order total must add up',
  pg_temp.sec_check(null, null,
    $q$update public.orders set discount = 5 where id = pg_temp.last_order_id(); set constraints all immediate$q$, 'error', 'does not add up',
    p_setup => $q$select pg_temp.demo_order()$q$)),
-- stock back on cancel / refuse
('owner', 'cancel gives stock back (product WITH options)',
  pg_temp.sec_check('authenticated', '00000000-0000-4000-8000-000000000002',
    $q$select public.cancel_order(pg_temp.last_order_id(), 'Customer changed mind');
       select 1 from public.product_variants v join public.products p on p.id = v.product_id
       where p.name = 'Cotton T-Shirt' and v.label = '4Y' and v.stock = 8$q$, 'rows',
    p_setup => $q$select pg_temp.add_member('00000000-0000-4000-8000-000000000002', 'owner');
      select pg_temp.demo_order('Cotton T-Shirt', 2, '70123456', '4Y')$q$)),
('owner', 'cancel gives stock back (product WITHOUT options)',
  pg_temp.sec_check('authenticated', '00000000-0000-4000-8000-000000000002',
    $q$select public.cancel_order(pg_temp.last_order_id(), 'Duplicate order');
       select 1 from public.products where name = 'Building Blocks Set' and stock = 4$q$, 'rows',
    p_setup => $q$select pg_temp.add_member('00000000-0000-4000-8000-000000000002', 'owner');
      select pg_temp.demo_order('Building Blocks Set', 3)$q$)),
('owner', 'refused gives stock back (product WITH options)',
  pg_temp.sec_check('authenticated', '00000000-0000-4000-8000-000000000002',
    $q$select public.confirm_order(pg_temp.last_order_id());
       select public.mark_refused(pg_temp.last_order_id());
       select 1 from public.product_variants v join public.products p on p.id = v.product_id
       where p.name = 'Whey Protein 1kg' and v.label = 'Vanilla' and v.stock = 3$q$, 'rows',
    p_setup => $q$select pg_temp.add_member('00000000-0000-4000-8000-000000000002', 'owner');
      select pg_temp.demo_order('Whey Protein 1kg', 2, '70123456', 'Vanilla')$q$)),
('owner', 'refused gives stock back (product WITHOUT options)',
  pg_temp.sec_check('authenticated', '00000000-0000-4000-8000-000000000002',
    $q$select public.confirm_order(pg_temp.last_order_id());
       select public.mark_refused(pg_temp.last_order_id());
       select 1 from public.products where name = 'Building Blocks Set' and stock = 4$q$, 'rows',
    p_setup => $q$select pg_temp.add_member('00000000-0000-4000-8000-000000000002', 'owner');
      select pg_temp.demo_order('Building Blocks Set', 2)$q$)),
('owner', 'paid order does NOT give stock back',
  pg_temp.sec_check('authenticated', '00000000-0000-4000-8000-000000000002',
    $q$select public.confirm_order(pg_temp.last_order_id());
       select public.mark_paid(pg_temp.last_order_id());
       select 1 from public.products where name = 'Building Blocks Set' and stock = 2$q$, 'rows',
    p_setup => $q$select pg_temp.add_member('00000000-0000-4000-8000-000000000002', 'owner');
      select pg_temp.demo_order('Building Blocks Set', 2)$q$)),
-- history, outcomes, numbers, email status
('owner', 'history: placed + confirmed + cancelled (with reason)',
  pg_temp.sec_check('authenticated', '00000000-0000-4000-8000-000000000002',
    $q$select public.confirm_order(pg_temp.last_order_id());
       select public.cancel_order(pg_temp.last_order_id(), 'Customer unreachable');
       select 1 from (select string_agg(text, ' | ' order by at, text) h from public.order_history
                      where order_id = pg_temp.last_order_id()) x
       where h like '%Order placed%' and h like '%Order confirmed%' and h like '%Cancelled: Customer unreachable%'$q$, 'rows',
    p_setup => $q$select pg_temp.add_member('00000000-0000-4000-8000-000000000002', 'owner'); select pg_temp.demo_order()$q$)),
('non-member', 'read order history',
  pg_temp.sec_check('authenticated', '00000000-0000-4000-8000-000000000001', 'select * from public.order_history', 'empty',
    p_setup => $q$select pg_temp.demo_order()$q$)),
('anon', 'read order history',
  pg_temp.sec_check('anon', null, 'select * from public.order_history', 'denied')),
('owner', 'paid → delivered outcome counted',
  pg_temp.sec_check('authenticated', '00000000-0000-4000-8000-000000000002',
    $q$select public.confirm_order(pg_temp.last_order_id());
       select public.mark_paid(pg_temp.last_order_id());
       select 1 from public.get_phone_risk('70123456') where delivered = 1 and refused = 0$q$, 'rows',
    p_setup => $q$select pg_temp.add_member('00000000-0000-4000-8000-000000000002', 'owner'); select pg_temp.demo_order()$q$)),
('owner', 'refused → refused outcome counted',
  pg_temp.sec_check('authenticated', '00000000-0000-4000-8000-000000000002',
    $q$select public.confirm_order(pg_temp.last_order_id());
       select public.mark_refused(pg_temp.last_order_id());
       select 1 from public.get_phone_risk('70123456') where delivered = 0 and refused = 1$q$, 'rows',
    p_setup => $q$select pg_temp.add_member('00000000-0000-4000-8000-000000000002', 'owner'); select pg_temp.demo_order()$q$)),
('database', 'order gets a display number like ABC-0001',
  pg_temp.sec_check(null, null,
    $q$select 1 from public.orders where id = pg_temp.last_order_id() and display_number ~ '^[A-Z0-9]{1,6}-[0-9]{4,}$'$q$, 'rows',
    p_setup => $q$select pg_temp.demo_order()$q$)),
('database', 'new order email status = pending',
  pg_temp.sec_check(null, null,
    $q$select 1 from public.orders where id = pg_temp.last_order_id() and email_status = 'pending'$q$, 'rows',
    p_setup => $q$update public.shop_notification_settings set order_emails = array['shop@example.com'], email_enabled = true
        where shop_id = (select id from public.shops where slug = 'kefada-demo');
      select pg_temp.demo_order()$q$)),
-- costs on order lines
('database', 'line copies the product cost when created',
  pg_temp.sec_check(null, null,
    $q$select 1 from public.order_items where order_id = pg_temp.last_order_id() and cost = 10$q$, 'rows',
    p_setup => $q$insert into public.product_costs (shop_id, product_id, wholesale_price)
        select shop_id, id, 10 from public.products where name = 'Building Blocks Set'
        on conflict (product_id) do update set wholesale_price = excluded.wholesale_price;
      select pg_temp.demo_order()$q$)),
('database', 'missing cost is filled the first time a cost is added',
  pg_temp.sec_check(null, null,
    $q$insert into public.product_costs (shop_id, product_id, wholesale_price)
         select shop_id, id, 12 from public.products where name = 'Kids Hoodie';
       select 1 from public.order_items where order_id = pg_temp.last_order_id() and cost = 12$q$, 'rows',
    p_setup => $q$select pg_temp.demo_order('Kids Hoodie', 1, p_variant => 'Navy / S');
      select 1 where exists (select 1 from public.order_items where order_id = pg_temp.last_order_id() and cost is null)$q$)),
('database', 'line cost stays locked when the cost changes later',
  pg_temp.sec_check(null, null,
    $q$update public.product_costs set wholesale_price = 15
        where product_id = (select id from public.products where name = 'Kids Hoodie');
       select 1 from public.order_items where order_id = pg_temp.last_order_id() and cost = 12$q$, 'rows',
    p_setup => $q$insert into public.product_costs (shop_id, product_id, wholesale_price)
        select shop_id, id, 12 from public.products where name = 'Kids Hoodie';
      select pg_temp.demo_order('Kids Hoodie', 1, p_variant => 'Navy / S')$q$)),
-- review tokens (server-only)
('anon', 'read review tokens',
  pg_temp.sec_check('anon', null, 'select * from public.order_review_tokens', 'denied')),
('owner', 'even the owner cannot read review tokens',
  pg_temp.sec_check('authenticated', '00000000-0000-4000-8000-000000000002', 'select * from public.order_review_tokens', 'denied',
    p_setup => $q$select pg_temp.add_member('00000000-0000-4000-8000-000000000002', 'owner')$q$)),
('database', 'paid order gets a review token',
  pg_temp.sec_check(null, null, 'select 1 where pg_temp.review_token() is not null', 'rows',
    p_setup => $q$select pg_temp.demo_order(); select pg_temp.pay_last_order()$q$)),
-- reviews
('server', 'buyer of a PAID order CAN review (control)',
  pg_temp.sec_check('service_role', null,
    $q$select public.submit_review(pg_temp.review_token(), (select id from public.products where name = 'Building Blocks Set'), 5, 'Rania', 'Great!')$q$, 'rows',
    p_setup => $q$update public.shops set reviews_on = true where slug = 'kefada-demo';
      select pg_temp.demo_order(); select pg_temp.pay_last_order()$q$)),
('server', 'review for a product NOT in the order (non-buyer)',
  pg_temp.sec_check('service_role', null,
    $q$select public.submit_review(pg_temp.review_token(), (select id from public.products where name = 'Cotton T-Shirt'), 5, 'Rania', 'x')$q$, 'error', 'not part of your order',
    p_setup => $q$update public.shops set reviews_on = true where slug = 'kefada-demo';
      select pg_temp.demo_order(); select pg_temp.pay_last_order()$q$)),
('server', 'review with a fake token',
  pg_temp.sec_check('service_role', null,
    $q$select public.submit_review('not-a-real-token', (select id from public.products where name = 'Building Blocks Set'), 5, 'Rania', 'x')$q$, 'error', 'not valid',
    p_setup => $q$update public.shops set reviews_on = true where slug = 'kefada-demo'$q$)),
('server', 'review for an order that is no longer paid',
  pg_temp.sec_check('service_role', null,
    $q$select public.submit_review(pg_temp.review_token(), (select id from public.products where name = 'Building Blocks Set'), 5, 'Rania', 'x')$q$, 'error', 'only be left for paid orders',
    p_setup => $q$update public.shops set reviews_on = true where slug = 'kefada-demo';
      select pg_temp.demo_order(); select pg_temp.pay_last_order();
      select set_config('app.reopen_paid_order', 'on', true);
      update public.orders set status = 'pending' where id = pg_temp.last_order_id()$q$)),
('server', 'unpaid order has no review token (cannot review)',
  pg_temp.sec_check(null, null, 'select 1 where pg_temp.review_token() is null', 'rows',
    p_setup => $q$select pg_temp.demo_order()$q$)),
('server', 'second review of the same product in the same order',
  pg_temp.sec_check('service_role', null,
    $q$select public.submit_review(pg_temp.review_token(), (select id from public.products where name = 'Building Blocks Set'), 4, 'Rania', 'again')$q$, 'error', 'already reviewed',
    p_setup => $q$update public.shops set reviews_on = true where slug = 'kefada-demo';
      select pg_temp.demo_order(); select pg_temp.pay_last_order();
      select public.submit_review(pg_temp.review_token(), (select id from public.products where name = 'Building Blocks Set'), 5, 'Rania', 'first')$q$)),
('server', 'reviews turned off → refused',
  pg_temp.sec_check('service_role', null,
    $q$select public.submit_review(pg_temp.review_token(), (select id from public.products where name = 'Building Blocks Set'), 5, 'Rania', 'x')$q$, 'error', 'not accepting reviews',
    p_setup => $q$select pg_temp.demo_order(); select pg_temp.pay_last_order()$q$)),
('anon', 'call submit_review directly',
  pg_temp.sec_check('anon', null,
    $q$select public.submit_review('x', gen_random_uuid(), 5, 'x', 'x')$q$, 'denied')),
('owner', 'logged-in users cannot call submit_review directly',
  pg_temp.sec_check('authenticated', '00000000-0000-4000-8000-000000000002',
    $q$select public.submit_review('x', gen_random_uuid(), 5, 'x', 'x')$q$, 'denied',
    p_setup => $q$select pg_temp.add_member('00000000-0000-4000-8000-000000000002', 'owner')$q$)),
('anon', 'PENDING review is not public',
  pg_temp.sec_check('anon', null, 'select * from public.product_reviews_public', 'empty',
    p_setup => $q$update public.shops set reviews_on = true, reviews_need_approval = true where slug = 'kefada-demo';
      select pg_temp.demo_order(); select pg_temp.pay_last_order();
      select public.submit_review(pg_temp.review_token(), (select id from public.products where name = 'Building Blocks Set'), 5, 'Rania', 'x')$q$)),
('anon', 'APPROVED review is public (control)',
  pg_temp.sec_check('anon', null, 'select * from public.product_reviews_public', 'rows',
    p_setup => $q$update public.shops set reviews_on = true, reviews_need_approval = false where slug = 'kefada-demo';
      select pg_temp.demo_order(); select pg_temp.pay_last_order();
      select public.submit_review(pg_temp.review_token(), (select id from public.products where name = 'Building Blocks Set'), 5, 'Rania', 'x')$q$)),
('anon', 'HIDDEN review is not public',
  pg_temp.sec_check('anon', null, 'select * from public.product_reviews_public', 'empty',
    p_setup => $q$update public.shops set reviews_on = true, reviews_need_approval = false where slug = 'kefada-demo';
      select pg_temp.demo_order(); select pg_temp.pay_last_order();
      select public.submit_review(pg_temp.review_token(), (select id from public.products where name = 'Building Blocks Set'), 5, 'Rania', 'x');
      update public.product_reviews set status = 'hidden'$q$)),
('anon', 'approved review hidden when the shop turns reviews off',
  pg_temp.sec_check('anon', null, 'select * from public.product_reviews_public', 'empty',
    p_setup => $q$update public.shops set reviews_on = true, reviews_need_approval = false where slug = 'kefada-demo';
      select pg_temp.demo_order(); select pg_temp.pay_last_order();
      select public.submit_review(pg_temp.review_token(), (select id from public.products where name = 'Building Blocks Set'), 5, 'Rania', 'x');
      update public.shops set reviews_on = false where slug = 'kefada-demo'$q$)),
('anon', 'review order_id is never public',
  pg_temp.sec_check('anon', null, 'select order_id from public.product_reviews_public', 'error', 'does not exist')),
('anon', 'read the reviews table directly',
  pg_temp.sec_check('anon', null, 'select * from public.product_reviews', 'denied')),
('non-member', 'read another shop''s reviews (incl. pending)',
  pg_temp.sec_check('authenticated', '00000000-0000-4000-8000-000000000001', 'select * from public.product_reviews', 'empty',
    p_setup => $q$update public.shops set reviews_on = true where slug = 'kefada-demo';
      select pg_temp.demo_order(); select pg_temp.pay_last_order();
      select public.submit_review(pg_temp.review_token(), (select id from public.products where name = 'Building Blocks Set'), 5, 'Rania', 'x')$q$)),
('owner', 'owner CAN approve a review (control)',
  pg_temp.sec_check('authenticated', '00000000-0000-4000-8000-000000000002',
    $q$update public.product_reviews set status = 'approved' returning id$q$, 'rows',
    p_setup => $q$select pg_temp.add_member('00000000-0000-4000-8000-000000000002', 'owner');
      update public.shops set reviews_on = true where slug = 'kefada-demo';
      select pg_temp.demo_order(); select pg_temp.pay_last_order();
      select public.submit_review(pg_temp.review_token(), (select id from public.products where name = 'Building Blocks Set'), 5, 'Rania', 'x')$q$)),
('owner', 'nobody can edit a review''s rating or text',
  pg_temp.sec_check('authenticated', '00000000-0000-4000-8000-000000000002',
    $q$update public.product_reviews set rating = 1, text = 'changed'$q$, 'denied',
    p_setup => $q$select pg_temp.add_member('00000000-0000-4000-8000-000000000002', 'owner');
      update public.shops set reviews_on = true where slug = 'kefada-demo';
      select pg_temp.demo_order(); select pg_temp.pay_last_order();
      select public.submit_review(pg_temp.review_token(), (select id from public.products where name = 'Building Blocks Set'), 5, 'Rania', 'x')$q$));

-- =====================================================================
-- K. BACK-OFFICE HOME NUMBERS (Step 7): shop_dashboard_summary
-- =====================================================================
insert into sec_results (who, test, result) values
('owner', 'owner CAN get their shop''s numbers (control)',
  pg_temp.sec_check('authenticated', '00000000-0000-4000-8000-000000000002',
    format('select 1 from public.shop_dashboard_summary(%L) where unconfirmed_count = 1',
           (select id from public.shops where slug = 'kefada-demo')), 'rows',
    p_setup => $q$select pg_temp.add_member('00000000-0000-4000-8000-000000000002', 'owner');
      select pg_temp.demo_order()$q$)),
('owner', 'numbers are right (unconfirmed, pending + total, month orders + sales without delivery)',
  pg_temp.sec_check('authenticated', '00000000-0000-4000-8000-000000000002',
    format($q$select 1 from public.shop_dashboard_summary(%L)
       where unconfirmed_count = 1 and pending_count = 1 and pending_total = 28
         and month_orders = 1 and month_sales = 25$q$,
           (select id from public.shops where slug = 'kefada-demo')), 'rows',
    p_setup => $q$select pg_temp.add_member('00000000-0000-4000-8000-000000000002', 'owner');
      select pg_temp.demo_order();
      update public.orders set status = 'pending' where id = pg_temp.last_order_id();
      select pg_temp.demo_order('Whey Protein 1kg', 1, p_variant => 'Chocolate')$q$)),
('staff', 'staff CAN get their shop''s numbers (control)',
  pg_temp.sec_check('authenticated', '00000000-0000-4000-8000-000000000003',
    format('select * from public.shop_dashboard_summary(%L)', (select id from public.shops where slug = 'kefada-demo')), 'rows',
    p_setup => $q$select pg_temp.add_member('00000000-0000-4000-8000-000000000003', 'staff')$q$)),
('non-member', 'get ANOTHER shop''s numbers',
  pg_temp.sec_check('authenticated', '00000000-0000-4000-8000-000000000001',
    format('select * from public.shop_dashboard_summary(%L)', (select id from public.shops where slug = 'kefada-demo')), 'denied',
    p_setup => $q$select pg_temp.demo_order()$q$)),
('anon', 'get a shop''s numbers',
  pg_temp.sec_check('anon', null,
    format('select * from public.shop_dashboard_summary(%L)', (select id from public.shops where slug = 'kefada-demo')), 'denied')),
('database', 'shop address "forgot-password" is reserved',
  pg_temp.sec_check(null, null,
    $q$insert into public.shops (name, slug) values ('X', 'forgot-password')$q$, 'error', 'shops_slug_not_reserved_step7'));

-- =====================================================================
-- G. CONFIGURATION checks (run as admin; each must find 0 problems)
-- =====================================================================
insert into sec_results (who, test, result) values
('config', 'every table in public has RLS enabled',
  pg_temp.sec_check(null, null, $q$select c.relname from pg_class c
     where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and not c.relrowsecurity$q$, 'empty')),
('config', 'every SECURITY DEFINER function sets search_path',
  pg_temp.sec_check(null, null, $q$select p.proname from pg_proc p
     where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace) and p.prosecdef
       and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')$q$, 'empty')),
-- (trigger / event-trigger functions are skipped: they can't be called
--  directly, only by the database itself — e.g. Supabase's own
--  rls_auto_enable() behind the "auto-enable RLS" setting)
('config', 'anon can run NO public function at all',
  pg_temp.sec_check(null, null, $q$select p.proname from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.prorettype not in ('trigger'::regtype, 'event_trigger'::regtype)
       and has_function_privilege('anon', p.oid, 'EXECUTE')$q$, 'empty')),
('config', 'logged-in users can run only the allowed public functions',
  pg_temp.sec_check(null, null, $q$select p.proname from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.prorettype not in ('trigger'::regtype, 'event_trigger'::regtype)
       and has_function_privilege('authenticated', p.oid, 'EXECUTE')
       and p.proname not in ('get_phone_risk',
                             'confirm_order', 'mark_paid', 'cancel_order', 'mark_refused',
                             'shop_dashboard_summary')$q$, 'empty')),
('config', 'anon can run NO private function',
  pg_temp.sec_check(null, null, $q$select p.proname from pg_proc p
     where p.pronamespace = 'private'::regnamespace and has_function_privilege('anon', p.oid, 'EXECUTE')$q$, 'empty')),
('config', 'anon has only SELECT, only on catalog tables',
  pg_temp.sec_check(null, null, $q$select table_name, privilege_type from information_schema.role_table_grants
     where grantee = 'anon' and table_schema = 'public'
       and not (privilege_type = 'SELECT'
                and table_name in ('shop_categories', 'shops', 'products', 'product_variants',
                                   'lebanon_governorates', 'lebanon_districts', 'shop_delivery_fees',
                                   'product_option_types', 'product_option_values', 'product_photos',
                                   'product_reviews_public'))$q$, 'empty')),
('config', 'costs, private settings and money are never granted to anon',
  pg_temp.sec_check(null, null, $q$select t from unnest(array['public.product_costs', 'public.shop_private_settings',
       'public.money_entries', 'public.order_history']) t
     where to_regclass(t) is not null and has_table_privilege('anon', t, 'SELECT, INSERT, UPDATE, DELETE')$q$, 'empty')),
('config', 'nobody but admin/server can touch delivery_outcomes',
  pg_temp.sec_check(null, null, $q$select r from unnest(array['anon', 'authenticated']) r
     where has_table_privilege(r, 'public.delivery_outcomes', 'SELECT, INSERT, UPDATE, DELETE')$q$, 'empty')),
('config', 'only the server can write notification_outbox',
  pg_temp.sec_check(null, null, $q$select r from unnest(array['anon', 'authenticated']) r
     where has_table_privilege(r, 'public.notification_outbox', 'INSERT, UPDATE, DELETE')$q$, 'empty')),
('config', 'only the server can run place_order',
  pg_temp.sec_check(null, null, $q$select r from unnest(array['anon', 'authenticated']) r
     where exists (select 1 from pg_proc p where p.proname = 'place_order' and p.pronamespace = 'public'::regnamespace
                   and has_function_privilege(r, p.oid, 'EXECUTE'))$q$, 'empty')),
('config', 'only the server can run claim_notifications',
  pg_temp.sec_check(null, null, $q$select r from unnest(array['anon', 'authenticated']) r
     where has_function_privilege(r, 'public.claim_notifications(integer)', 'EXECUTE')$q$, 'empty')),
('config', 'phone_hash_salt exists in Vault',
  pg_temp.sec_check(null, null, $q$select 1 from vault.secrets where name = 'phone_hash_salt'$q$, 'rows'));

-- =====================================================================
-- RESULTS
-- =====================================================================
insert into sec_results (who, test, result)
select '=====', 'TOTAL',
       format('%s PASS, %s FAIL, %s SKIP',
              count(*) filter (where result like 'PASS%'),
              count(*) filter (where result like 'FAIL%'),
              count(*) filter (where result like 'SKIP%'))
from sec_results;

select who, test, result from sec_results order by n;
