-- =====================================================================
-- Make a user the OWNER of a shop.
--
-- 1. First create the user: Supabase → Authentication → Users →
--    "Add user" → "Create new user" (email + password, tick
--    "Auto Confirm User").
-- 2. Change the two values below (email and shop address), then run
--    this whole file in the SQL Editor.
--
-- Safe to run again. Note: re-running seed.sql recreates the demo shop
-- and removes its members — run this file again after the seed.
-- =====================================================================

do $$
declare
  v_email text := 'YOUR-EMAIL@example.com';   -- 👉 your login email
  v_slug  text := 'kefada-demo';              -- 👉 the shop's address
  v_user  uuid;
  v_shop  uuid;
begin
  select id into v_user from auth.users where lower(email) = lower(trim(v_email));
  if v_user is null then
    raise exception 'No user with email "%". Create it first in Authentication → Users.', v_email;
  end if;

  select id into v_shop from public.shops where slug = v_slug;
  if v_shop is null then
    raise exception 'No shop with address "%".', v_slug;
  end if;

  insert into public.shop_members (shop_id, user_id, role)
  values (v_shop, v_user, 'owner')
  on conflict (shop_id, user_id) do update set role = 'owner';

  raise notice 'Done: % is now the owner of %.', v_email, v_slug;
end;
$$;

-- Check: who is a member of the shop?
select s.slug as shop, u.email, m.role
from public.shop_members m
join public.shops s on s.id = m.shop_id
join auth.users u on u.id = m.user_id
order by s.slug, m.role, u.email;
