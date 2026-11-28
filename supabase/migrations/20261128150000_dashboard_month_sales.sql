-- =====================================================================
-- Step 7 fix: this month's sales on the back-office Home.
-- Run once, after 20261128140000_dashboard_summary.sql.
--
--   month_sales = paid + pending orders placed this month,
--                 subtotal − discount
--                 (WITHOUT delivery fee and WITHOUT extra fees).
--   "This month" = calendar month in Lebanon's time zone (Asia/Beirut),
--   not UTC.
-- Same function name and columns as before; only the sales formula changes.
-- =====================================================================

create or replace function public.shop_dashboard_summary(p_shop_id uuid)
returns table (
  unconfirmed_count  integer,
  pending_count      integer,
  pending_total      numeric,   -- what is still to collect (incl. delivery)
  month_orders       integer,   -- paid + pending orders placed this month
  month_sales        numeric    -- their subtotal − discount (no delivery, no extra fees)
)
language plpgsql stable security invoker set search_path = ''
as $$
declare
  -- First moment of the current month in Beirut, as an exact timestamp.
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
    coalesce(sum(o.subtotal - o.discount)
               filter (where o.status in ('paid', 'pending') and o.created_at >= v_month_start), 0)
  from public.orders o
  where o.shop_id = p_shop_id;
end;
$$;

-- (create or replace keeps the permissions; restated to be explicit)
revoke all on function public.shop_dashboard_summary(uuid) from public, anon, authenticated;
grant execute on function public.shop_dashboard_summary(uuid) to authenticated, service_role;
