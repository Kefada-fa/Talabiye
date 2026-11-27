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
  v_result text;
begin
  begin
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

    v_result := case p_expect
      when 'empty' then case when v_count = 0 then 'PASS (0 rows)'
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
  pg_temp.sec_check('anon', null, $q$insert into public.order_items (shop_id, order_id, name_snapshot, price_snapshot, quantity)
     select id, gen_random_uuid(), 'x', 0, 1 from public.shops limit 1$q$, 'denied')),
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
    p_setup => $q$select public.place_order('kefada-demo', 'Test', '70123456', 'Beirut', 'Street 1',
      jsonb_build_array(jsonb_build_object('product_id', (select id from public.products where name = 'Building Blocks Set'), 'quantity', 1)))$q$)),
('non-member', 'read orders (and confirm_token)',
  pg_temp.sec_check('authenticated', '00000000-0000-4000-8000-000000000001', 'select confirm_token from public.orders', 'empty',
    p_setup => $q$select public.place_order('kefada-demo', 'Test', '70123456', 'Beirut', 'Street 1',
      jsonb_build_array(jsonb_build_object('product_id', (select id from public.products where name = 'Building Blocks Set'), 'quantity', 1)))$q$)),
('non-member', 'read order_items',
  pg_temp.sec_check('authenticated', '00000000-0000-4000-8000-000000000001', 'select * from public.order_items', 'empty',
    p_setup => $q$select public.place_order('kefada-demo', 'Test', '70123456', 'Beirut', 'Street 1',
      jsonb_build_array(jsonb_build_object('product_id', (select id from public.products where name = 'Building Blocks Set'), 'quantity', 1)))$q$)),
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
  pg_temp.sec_check('authenticated', '00000000-0000-4000-8000-000000000001', 'update public.shops set delivery_fee = 0', 'empty')),
('non-member', 'change shop plan',
  pg_temp.sec_check('authenticated', '00000000-0000-4000-8000-000000000001', $q$update public.shops set plan = 'pro'$q$, 'denied')),
('non-member', 'delete products',
  pg_temp.sec_check('authenticated', '00000000-0000-4000-8000-000000000001', 'delete from public.products', 'empty')),
('non-member', 'mark orders delivered',
  pg_temp.sec_check('authenticated', '00000000-0000-4000-8000-000000000001', $q$update public.orders set status = 'delivered'$q$, 'empty',
    p_setup => $q$select public.place_order('kefada-demo', 'Test', '70123456', 'Beirut', 'Street 1',
      jsonb_build_array(jsonb_build_object('product_id', (select id from public.products where name = 'Building Blocks Set'), 'quantity', 1)))$q$)),
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
-- F. place_order rules (as anon)
-- =====================================================================
insert into sec_results (who, test, result) values
('anon', 'place_order: valid order works (control)',
  pg_temp.sec_check('anon', null, $q$select public.place_order('kefada-demo', 'Test', '70123456', 'Beirut', 'Street 1',
     jsonb_build_array(jsonb_build_object('product_id', (select id from public.products where name = 'Building Blocks Set'), 'quantity', 1)))$q$, 'rows')),
('anon', 'place_order: reply does NOT include confirm_token',
  pg_temp.sec_check('anon', null, $q$select 1 where not (public.place_order('kefada-demo', 'Test', '70123456', 'Beirut', 'Street 1',
     jsonb_build_array(jsonb_build_object('product_id', (select id from public.products where name = 'Building Blocks Set'), 'quantity', 1))) ? 'confirm_token')$q$, 'rows')),
('anon', 'place_order: unknown shop',
  pg_temp.sec_check('anon', null, $q$select public.place_order('no-such-shop', 'Test', '70123456', 'Beirut', 'Street 1',
     jsonb_build_array(jsonb_build_object('product_id', gen_random_uuid(), 'quantity', 1)))$q$, 'error', 'Shop not found')),
('anon', 'place_order: inactive shop',
  pg_temp.sec_check('anon', null, $q$select public.place_order('kefada-demo', 'Test', '70123456', 'Beirut', 'Street 1',
     jsonb_build_array(jsonb_build_object('product_id', gen_random_uuid(), 'quantity', 1)))$q$, 'error', 'Shop not found',
    p_setup => $q$update public.shops set is_active = false where slug = 'kefada-demo'$q$)),
-- (the product id is looked up as admin first: a visitor can't see an
--  inactive product, but could have saved its id while it was active)
('anon', 'place_order: inactive product (using its saved id)',
  pg_temp.sec_check('anon', null, format($q$select public.place_order('kefada-demo', 'Test', '70123456', 'Beirut', 'Street 1',
     jsonb_build_array(jsonb_build_object('product_id', %L, 'quantity', 1)))$q$,
     (select id from public.products where name = 'Building Blocks Set')),
    'error', 'no longer available',
    p_setup => $q$update public.products set is_active = false where name = 'Building Blocks Set'$q$)),
('anon', 'place_order: product from ANOTHER shop',
  pg_temp.sec_check('anon', null, $q$select public.place_order('kefada-demo', 'Test', '70123456', 'Beirut', 'Street 1',
     jsonb_build_array(jsonb_build_object('product_id', (select id from public.products where name = 'SecTest Product'), 'quantity', 1)))$q$,
    'error', 'no longer available',
    p_setup => $q$insert into public.shops (name, slug) values ('Security Test Shop', 'sec-test-shop');
      insert into public.products (shop_id, name, price) select id, 'SecTest Product', 5 from public.shops where slug = 'sec-test-shop'$q$)),
('anon', 'place_order: option from ANOTHER shop',
  pg_temp.sec_check('anon', null, $q$select public.place_order('kefada-demo', 'Test', '70123456', 'Beirut', 'Street 1',
     jsonb_build_array(jsonb_build_object(
       'product_id', (select id from public.products where name = 'Cotton T-Shirt'),
       'variant_id', (select id from public.product_variants where label = 'SecTest Red'),
       'quantity', 1)))$q$,
    'error', 'option in your cart is no longer available',
    p_setup => $q$insert into public.shops (name, slug) values ('Security Test Shop', 'sec-test-shop');
      insert into public.products (shop_id, name, price, option_label) select id, 'SecTest Product', 5, 'Color' from public.shops where slug = 'sec-test-shop';
      insert into public.product_variants (shop_id, product_id, label, stock) select shop_id, id, 'SecTest Red', 5 from public.products where name = 'SecTest Product'$q$)),
('anon', 'place_order: quantity 0',
  pg_temp.sec_check('anon', null, $q$select public.place_order('kefada-demo', 'Test', '70123456', 'Beirut', 'Street 1',
     jsonb_build_array(jsonb_build_object('product_id', (select id from public.products where name = 'Building Blocks Set'), 'quantity', 0)))$q$,
    'error', 'from 1 to 20')),
('anon', 'place_order: quantity -1',
  pg_temp.sec_check('anon', null, $q$select public.place_order('kefada-demo', 'Test', '70123456', 'Beirut', 'Street 1',
     jsonb_build_array(jsonb_build_object('product_id', (select id from public.products where name = 'Building Blocks Set'), 'quantity', -1)))$q$,
    'error', 'from 1 to 20')),
('anon', 'place_order: quantity 21',
  pg_temp.sec_check('anon', null, $q$select public.place_order('kefada-demo', 'Test', '70123456', 'Beirut', 'Street 1',
     jsonb_build_array(jsonb_build_object('product_id', (select id from public.products where name = 'Building Blocks Set'), 'quantity', 21)))$q$,
    'error', 'from 1 to 20')),
('anon', 'place_order: quantity 1.5',
  pg_temp.sec_check('anon', null, $q$select public.place_order('kefada-demo', 'Test', '70123456', 'Beirut', 'Street 1',
     jsonb_build_array(jsonb_build_object('product_id', (select id from public.products where name = 'Building Blocks Set'), 'quantity', 1.5)))$q$,
    'error', 'from 1 to 20')),
('anon', 'place_order: quantity as text "2"',
  pg_temp.sec_check('anon', null, $q$select public.place_order('kefada-demo', 'Test', '70123456', 'Beirut', 'Street 1',
     jsonb_build_array(jsonb_build_object('product_id', (select id from public.products where name = 'Building Blocks Set'), 'quantity', '2')))$q$,
    'error', 'from 1 to 20')),
('anon', 'place_order: hide -5 inside a total (-5 + 10)',
  pg_temp.sec_check('anon', null, $q$select public.place_order('kefada-demo', 'Test', '70123456', 'Beirut', 'Street 1',
     jsonb_build_array(
       jsonb_build_object('product_id', (select id from public.products where name = 'Building Blocks Set'), 'quantity', -5),
       jsonb_build_object('product_id', (select id from public.products where name = 'Building Blocks Set'), 'quantity', 10)))$q$,
    'error', 'from 1 to 20')),
('anon', 'place_order: same item twice, 15 + 10 = 25',
  pg_temp.sec_check('anon', null, $q$select public.place_order('kefada-demo', 'Test', '70123456', 'Beirut', 'Street 1',
     jsonb_build_array(
       jsonb_build_object('product_id', (select id from public.products where name = 'Whey Protein 1kg'),
                          'variant_id', (select id from public.product_variants where label = 'Chocolate'), 'quantity', 15),
       jsonb_build_object('product_id', (select id from public.products where name = 'Whey Protein 1kg'),
                          'variant_id', (select id from public.product_variants where label = 'Chocolate'), 'quantity', 10)))$q$,
    'error', 'at most 20')),
('anon', 'place_order: 31 cart entries',
  pg_temp.sec_check('anon', null, $q$select public.place_order('kefada-demo', 'Test', '70123456', 'Beirut', 'Street 1',
     (select jsonb_agg(jsonb_build_object('product_id', (select id from public.products where name = 'Building Blocks Set'), 'quantity', 1))
      from generate_series(1, 31)))$q$,
    'error', 'Too many items')),
('anon', 'place_order: more than stock (oversell)',
  pg_temp.sec_check('anon', null, $q$select public.place_order('kefada-demo', 'Test', '70123456', 'Beirut', 'Street 1',
     jsonb_build_array(jsonb_build_object('product_id', (select id from public.products where name = 'Building Blocks Set'), 'quantity', 5)))$q$,
    'error', 'Only 4 left',
    p_setup => $q$update public.products set stock = 4 where name = 'Building Blocks Set'$q$)),
('anon', 'place_order: price sent by browser is ignored',
  pg_temp.sec_check('anon', null, $q$select 1 where (public.place_order('kefada-demo', 'Test', '70123456', 'Beirut', 'Street 1',
     jsonb_build_array(jsonb_build_object('product_id', (select id from public.products where name = 'Building Blocks Set'),
                                          'quantity', 1, 'price', 0))) ->> 'subtotal')::numeric = 25$q$, 'rows')),
('anon', 'place_order: cannot rename an existing customer',
  pg_temp.sec_check(null, null, $q$select 1 from public.customers where phone = '+96170999888' and name = 'Original Name'$q$, 'rows',
    p_setup => $q$select public.place_order('kefada-demo', 'Original Name', '70999888', 'Beirut', 'Street 1',
       jsonb_build_array(jsonb_build_object('product_id', (select id from public.products where name = 'Building Blocks Set'), 'quantity', 1)));
     select public.place_order('kefada-demo', 'Someone Else', '70 999 888', 'Beirut', 'Street 2',
       jsonb_build_array(jsonb_build_object('product_id', (select id from public.products where name = 'Building Blocks Set'), 'quantity', 1)))$q$));

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
('config', 'anon can run NO public function except place_order',
  pg_temp.sec_check(null, null, $q$select p.proname from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and has_function_privilege('anon', p.oid, 'EXECUTE') and p.proname <> 'place_order'$q$, 'empty')),
('config', 'logged-in users can run no public function except place_order/get_phone_risk',
  pg_temp.sec_check(null, null, $q$select p.proname from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and has_function_privilege('authenticated', p.oid, 'EXECUTE')
       and p.proname not in ('place_order', 'get_phone_risk')$q$, 'empty')),
('config', 'anon can run NO private function',
  pg_temp.sec_check(null, null, $q$select p.proname from pg_proc p
     where p.pronamespace = 'private'::regnamespace and has_function_privilege('anon', p.oid, 'EXECUTE')$q$, 'empty')),
('config', 'anon has only SELECT, only on catalog tables',
  pg_temp.sec_check(null, null, $q$select table_name, privilege_type from information_schema.role_table_grants
     where grantee = 'anon' and table_schema = 'public'
       and not (privilege_type = 'SELECT'
                and table_name in ('shop_categories', 'shops', 'products', 'product_variants'))$q$, 'empty')),
('config', 'nobody but admin/server can touch delivery_outcomes',
  pg_temp.sec_check(null, null, $q$select r from unnest(array['anon', 'authenticated']) r
     where has_table_privilege(r, 'public.delivery_outcomes', 'SELECT, INSERT, UPDATE, DELETE')$q$, 'empty')),
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
