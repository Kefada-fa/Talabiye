-- =====================================================================
-- Step 7: back office shell.
-- Run once, after 20261128130000_pickup_toggle.sql.
--
--   1. shop_dashboard_summary(shop_id) — the few real numbers for the
--      back-office Home: unconfirmed orders, pending orders (+ total to
--      collect), this month's orders and sales (paid + pending, without
--      delivery fees). Runs AS THE LOGGED-IN USER (security invoker, so
--      Row Level Security applies) and refuses anyone who isn't a member
--      of that shop — another shop's numbers can never leak.
--   2. Reserve the new login page addresses so no shop can take them
--      as its URL (talabiye.com/forgot-password …).
-- =====================================================================

create function public.shop_dashboard_summary(p_shop_id uuid)
returns table (
  unconfirmed_count  integer,
  pending_count      integer,
  pending_total      numeric,   -- what is still to collect (incl. delivery)
  month_orders       integer,   -- paid + pending orders placed this month
  month_sales        numeric    -- their totals WITHOUT delivery fees
)
language plpgsql stable security invoker set search_path = ''
as $$
declare
  -- "This month" in Lebanon's time zone.
  v_month_start timestamptz :=
    date_trunc('month', now() at time zone 'Asia/Beirut') at time zone 'Asia/Beirut';
begin
  if p_shop_id is null or not private.is_shop_member(p_shop_id) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  return query
  select
    (count(*) filter (where o.status = 'unconfirmed'))::integer,
    (count(*) filter (where o.status = 'pending'))::integer,
    coalesce(sum(o.total) filter (where o.status = 'pending'), 0),
    (count(*) filter (where o.status in ('paid', 'pending') and o.created_at >= v_month_start))::integer,
    coalesce(sum(o.total - o.delivery_fee)
               filter (where o.status in ('paid', 'pending') and o.created_at >= v_month_start), 0)
  from public.orders o
  where o.shop_id = p_shop_id;
end;
$$;

revoke all on function public.shop_dashboard_summary(uuid) from public, anon, authenticated;
grant execute on function public.shop_dashboard_summary(uuid) to authenticated, service_role;

-- New pages at the top level of the site.
alter table public.shops
  add constraint shops_slug_not_reserved_step7
  check (slug not in ('forgot-password', 'reset-password'));
