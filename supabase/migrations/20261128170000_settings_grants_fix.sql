-- =====================================================================
-- Step 8 fix: permissions of the two new tables.
-- Run once, after 20261128160000_settings_page.sql.
--
-- Supabase gives new tables TRUNCATE / REFERENCES / TRIGGER rights for
-- anon and authenticated by default. TRUNCATE skips Row Level Security,
-- so we remove everything and grant back only what's needed
-- (same as every earlier migration does).
-- =====================================================================

revoke all on public.shop_catalog_labels, public.shop_option_presets
  from public, anon, authenticated;

-- Collections/categories: public can read (shop filters); owners add and
-- reorder; names change only through rename_/delete_catalog_label()
-- (a guard trigger blocks direct changes).
grant select on public.shop_catalog_labels to anon;
grant select, insert, delete on public.shop_catalog_labels to authenticated;
grant update (name, position) on public.shop_catalog_labels to authenticated;

-- Favourite option types: members only.
grant select, insert, delete on public.shop_option_presets to authenticated;
grant update (name, "values", position) on public.shop_option_presets to authenticated;

grant all on public.shop_catalog_labels, public.shop_option_presets to service_role;
