-- =====================================================================
-- Step 8: back-office Settings page.
-- Run once, after 20261128150000_dashboard_month_sales.sql.
--
--   1. New shop settings: tagline, pickup note, logo + share image,
--      open/closed (accepting_orders), minimum order, max pieces.
--   2. Tighter checks on existing settings (WhatsApp = mobile only,
--      Instagram/Facebook formats, text lengths, prefix 2–5 characters…).
--   3. Owners can NO LONGER change slug / is_active / is_listed /
--      category_id / logo_url directly (platform decisions or read-only).
--   4. Private settings: deposits + WhatsApp message templates.
--   5. Notifications: max 3 emails; staff can READ the settings.
--   6. Catalog lists (collections, categories) + favourite option types.
--   7. save_delivery_settings(): delivery + pickup + fees in one go.
--   8. Storage bucket "shop-assets" (logo, share image) + its rules.
--   9. place_order: closed shop, minimum order, the shop's own max pieces.
--
-- Only OWNERS can change settings (RLS policies use private.is_shop_owner);
-- staff can read them. Every function here runs as the logged-in user
-- (security invoker), so the same RLS rules apply inside them.
-- =====================================================================


-- =====================================================================
-- 1 + 2. SHOPS: new columns and tighter checks
-- =====================================================================
alter table public.shops
  add column tagline           text,
  add column pickup_note       text,
  add column logo_path         text,     -- file in the "shop-assets" bucket
  add column share_image_path  text,     -- link preview image (same bucket)
  add column accepting_orders  boolean not null default true,  -- owner's open/closed switch
  add column closed_message    text,
  add column min_order_amount  numeric(10,2),   -- subtotal before delivery; null = no minimum
  add column max_pieces        integer not null default 20;

-- Clean existing data so the new checks can be added.
update public.shops set delivery_note = left(delivery_note, 160) where char_length(delivery_note) > 160;
update public.shops set policy_text   = left(policy_text, 1000)  where char_length(policy_text) > 1000;
update public.shops set description   = left(description, 160)   where char_length(description) > 160;
update public.shops set low_stock_at  = 99 where low_stock_at > 99;
update public.shops set whatsapp_number = null
 where whatsapp_number is not null
   and whatsapp_number !~ '^\+961(3[0-9]{6}|(70|71|76|78|79|81)[0-9]{6})$';
update public.shops set instagram = nullif(regexp_replace(trim(instagram), '^@', ''), '')
 where instagram is not null;
update public.shops set instagram = null
 where instagram is not null and instagram !~ '^[A-Za-z0-9._]{1,30}$';
update public.shops set facebook = null
 where facebook is not null
   and facebook !~ '^https://(www\.|m\.|web\.)?(facebook\.com|fb\.com)/[^[:space:]]{1,170}$';
update public.shops set hero_text = nullif(trim(hero_text), '') where hero_text is not null;
-- A policy that is "on" needs text.
update public.shops set policy_on = false
 where policy_on and nullif(trim(coalesce(policy_text, '')), '') is null;

-- New shops: no policy until the owner writes one.
alter table public.shops alter column policy_on set default false;

alter table public.shops
  add constraint shops_name_not_blank       check (char_length(trim(name)) between 1 and 100),
  add constraint shops_tagline_len          check (char_length(trim(tagline)) between 1 and 80),
  add constraint shops_description_len      check (char_length(trim(description)) between 1 and 160),
  add constraint shops_hero_len             check (char_length(trim(hero_text)) between 1 and 300),
  add constraint shops_delivery_note_len    check (char_length(trim(delivery_note)) between 1 and 160),
  add constraint shops_pickup_note_len      check (char_length(trim(pickup_note)) between 1 and 160),
  add constraint shops_policy_len           check (char_length(trim(policy_text)) between 1 and 1000),
  add constraint shops_policy_needs_text    check (not policy_on or policy_text is not null),
  add constraint shops_closed_message_len   check (char_length(trim(closed_message)) between 1 and 200),
  add constraint shops_low_stock_range      check (low_stock_at between 0 and 99),
  add constraint shops_whatsapp_mobile
    check (whatsapp_number ~ '^\+961(3[0-9]{6}|(70|71|76|78|79|81)[0-9]{6})$'),
  add constraint shops_instagram_username   check (instagram ~ '^[A-Za-z0-9._]{1,30}$'),
  add constraint shops_facebook_link
    check (facebook ~ '^https://(www\.|m\.|web\.)?(facebook\.com|fb\.com)/[^[:space:]]{1,170}$'),
  add constraint shops_delivery_fixed_range check (delivery_fixed between 0 and 1000),
  add constraint shops_free_above_range     check (free_delivery_above <= 100000),
  add constraint shops_min_order_range      check (min_order_amount > 0 and min_order_amount <= 100000),
  add constraint shops_max_pieces_range     check (max_pieces between 1 and 50),
  -- Files must be inside the shop's OWN folder: "<shop id>/logo-….webp".
  add constraint shops_logo_path_own_folder
    check (logo_path ~ '^[0-9a-f-]{36}/logo-[A-Za-z0-9-]{1,64}\.(webp|jpg|png)$'
           and split_part(logo_path, '/', 1) = id::text),
  add constraint shops_share_image_own_folder
    check (share_image_path ~ '^[0-9a-f-]{36}/share-[A-Za-z0-9-]{1,64}\.(webp|jpg|png)$'
           and split_part(share_image_path, '/', 1) = id::text);

-- Per-governorate fees: same sane range.
alter table public.shop_delivery_fees
  add constraint shop_delivery_fees_range check (fee <= 1000);


-- =====================================================================
-- 3. SHOPS: what owners may change directly
-- =====================================================================
-- Platform decisions / read-only: slug (links already shared), is_active
-- (suspension), is_listed (mall), category_id (mall), logo_url (old field,
-- replaced by logo_path).
revoke update (slug, is_active, is_listed, category_id, logo_url) on public.shops from authenticated;

-- Delivery/pickup columns are saved through save_delivery_settings()
-- (below), which checks everything together — but they stay updatable
-- directly too (RLS: owners only; table checks still apply).
grant update (name, tagline, description, hero_text, whatsapp_number, instagram, facebook,
              primary_color, accent_color, logo_path, share_image_path,
              pickup_note, accepting_orders, closed_message, min_order_amount, max_pieces)
  on public.shops to authenticated;


-- =====================================================================
-- 4. PRIVATE SETTINGS: deposits + WhatsApp templates (members only)
-- =====================================================================
update public.shop_private_settings set invoice_prefix = 'ORD'
 where invoice_prefix !~ '^[A-Z0-9]{2,5}$';

alter table public.shop_private_settings
  add column deposit_on            boolean not null default false,
  add column deposit_type          text not null default 'fixed'
                                   check (deposit_type in ('fixed', 'delivery_fee')),
  add column deposit_amount        numeric(10,2) check (deposit_amount > 0 and deposit_amount <= 10000),
  add column deposit_instructions  text check (char_length(trim(deposit_instructions)) between 1 and 300),
  -- WhatsApp messages; null = use the default text (lib/i18n/en.ts).
  add column wa_confirm_template   text check (char_length(trim(wa_confirm_template)) between 1 and 1000),
  add column wa_deposit_template   text check (char_length(trim(wa_deposit_template)) between 1 and 1000),
  add column wa_review_template    text check (char_length(trim(wa_review_template)) between 1 and 1000),
  add constraint shop_private_settings_prefix_2_5 check (invoice_prefix ~ '^[A-Z0-9]{2,5}$'),
  add constraint shop_private_settings_deposit_amount
    check (not deposit_on or deposit_type = 'delivery_fee' or deposit_amount is not null);

grant update (deposit_on, deposit_type, deposit_amount, deposit_instructions,
              wa_confirm_template, wa_deposit_template, wa_review_template)
  on public.shop_private_settings to authenticated;


-- =====================================================================
-- 5. NOTIFICATION SETTINGS: max 3 emails, no duplicates; staff can read
-- =====================================================================
update public.shop_notification_settings
   set order_emails = order_emails[1:3]
 where cardinality(order_emails) > 3;

-- Max 3 addresses, no address twice (any capitals).
create function private.is_valid_order_emails(p_emails text[])
returns boolean
language sql immutable set search_path = ''
as $$
  select coalesce(cardinality(p_emails), 0) <= 3
     and coalesce(cardinality(p_emails), 0) = (select count(distinct lower(e)) from unnest(p_emails) e);
$$;
revoke all on function private.is_valid_order_emails(text[]) from public, anon, authenticated;
grant execute on function private.is_valid_order_emails(text[]) to authenticated, service_role;

alter table public.shop_notification_settings
  add constraint shop_notification_settings_max_3_unique
    check (private.is_valid_order_emails(order_emails));

create policy "Members can view their notification settings"
  on public.shop_notification_settings for select to authenticated
  using (private.is_shop_member(shop_id));


-- =====================================================================
-- 6. CATALOG LISTS + FAVOURITE OPTION TYPES
-- =====================================================================
-- Collections and categories: the shop's own free lists, in its order.
-- Products keep using text (products.collection, products.categories);
-- renaming / deleting here also updates the products (functions below).
create table public.shop_catalog_labels (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  shop_id     uuid not null references public.shops (id) on delete cascade,
  kind        text not null check (kind in ('collection', 'category')),
  name        text not null check (name = trim(name) and char_length(name) between 1 and 50),
  position    integer not null default 0 check (position between 0 and 10000)
);
create unique index shop_catalog_labels_name_key
  on public.shop_catalog_labels (shop_id, kind, lower(name));

-- Favourite option types, e.g. Size: 2Y, 3Y, 4Y — one-tap presets in Step 9.
create function private.is_valid_preset_values(p_values text[])
returns boolean
language sql immutable set search_path = ''
as $$
  select coalesce(cardinality(p_values), 0) between 1 and 50
     and coalesce(bool_and(v is not null and v = trim(v) and char_length(v) between 1 and 50), false)
     and cardinality(p_values) = (select count(distinct lower(x)) from unnest(p_values) x)
  from unnest(p_values) as v;
$$;

create table public.shop_option_presets (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  shop_id     uuid not null references public.shops (id) on delete cascade,
  name        text not null check (name = trim(name) and char_length(name) between 1 and 50),
  "values"    text[] not null check (private.is_valid_preset_values("values")),
  position    integer not null default 0 check (position between 0 and 10000)
);
create unique index shop_option_presets_name_key
  on public.shop_option_presets (shop_id, lower(name));

-- Max 100 labels per list and 30 presets per shop.
create function private.check_settings_list_limits()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_table_name = 'shop_catalog_labels' then
    if (select count(*) from public.shop_catalog_labels l
        where l.shop_id = new.shop_id and l.kind = new.kind) > 100 then
      raise exception 'A list can have at most 100 names' using errcode = '23514';
    end if;
  elsif (select count(*) from public.shop_option_presets p where p.shop_id = new.shop_id) > 30 then
    raise exception 'You can save at most 30 option types' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger shop_catalog_labels_limit after insert on public.shop_catalog_labels
  for each row execute function private.check_settings_list_limits();
create trigger shop_option_presets_limit after insert on public.shop_option_presets
  for each row execute function private.check_settings_list_limits();

-- Fill the lists from what products already use (alphabetical).
insert into public.shop_catalog_labels (shop_id, kind, name, position)
select shop_id, 'collection', name, (row_number() over (partition by shop_id order by lower(name)))::integer
from (select distinct on (p.shop_id, lower(trim(p.collection))) p.shop_id, trim(p.collection) as name
      from public.products p
      where p.collection is not null and char_length(trim(p.collection)) between 1 and 50) c
on conflict do nothing;

insert into public.shop_catalog_labels (shop_id, kind, name, position)
select shop_id, 'category', name, (row_number() over (partition by shop_id order by lower(name)))::integer
from (select distinct on (p.shop_id, lower(trim(c))) p.shop_id, trim(c) as name
      from public.products p, unnest(p.categories) c
      where char_length(trim(c)) between 1 and 50) c
on conflict do nothing;

alter table public.shop_catalog_labels enable row level security;
alter table public.shop_option_presets enable row level security;

-- Collections/categories are public for active shops (shop filters, Step 10).
create policy "Public can view catalog lists of active shops"
  on public.shop_catalog_labels for select to anon, authenticated
  using (exists (select 1 from public.shops s where s.id = shop_id and s.is_active));
create policy "Members can view their catalog lists"
  on public.shop_catalog_labels for select to authenticated
  using (private.is_shop_member(shop_id));
create policy "Owners can add to their catalog lists"
  on public.shop_catalog_labels for insert to authenticated
  with check (private.is_shop_owner(shop_id));
create policy "Owners can reorder their catalog lists"
  on public.shop_catalog_labels for update to authenticated
  using (private.is_shop_owner(shop_id))
  with check (private.is_shop_owner(shop_id));
create policy "Owners can delete from their catalog lists"
  on public.shop_catalog_labels for delete to authenticated
  using (private.is_shop_owner(shop_id));

-- Option presets: members only (never public).
create policy "Members can view their option presets"
  on public.shop_option_presets for select to authenticated
  using (private.is_shop_member(shop_id));
create policy "Owners can manage their option presets"
  on public.shop_option_presets for all to authenticated
  using (private.is_shop_owner(shop_id))
  with check (private.is_shop_owner(shop_id));

-- Names change only via rename_catalog_label / delete_catalog_label (so
-- products stay in sync); direct changes are limited to the order.
grant select on public.shop_catalog_labels to anon;
grant select, insert on public.shop_catalog_labels to authenticated;
grant update (position) on public.shop_catalog_labels to authenticated;
grant select, insert, delete on public.shop_option_presets to authenticated;
grant update (name, "values", position) on public.shop_option_presets to authenticated;
grant all on public.shop_catalog_labels, public.shop_option_presets to service_role;


-- How many products use each list name (for "3 products use 'Boys'").
create function public.catalog_label_usage(p_shop_id uuid)
returns table (label_id uuid, products integer)
language plpgsql stable security invoker set search_path = ''
as $$
begin
  if p_shop_id is null or not private.is_shop_member(p_shop_id) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  return query
  select l.id,
         (select count(*)::integer from public.products p
          where p.shop_id = l.shop_id
            and case when l.kind = 'collection'
                     then lower(p.collection) = lower(l.name)
                     else exists (select 1 from unnest(p.categories) c where lower(c) = lower(l.name)) end)
  from public.shop_catalog_labels l
  where l.shop_id = p_shop_id;
end;
$$;

-- Rename a collection/category AND every product that uses it.
-- Returns how many products were updated.
create function public.rename_catalog_label(p_label_id uuid, p_new_name text)
returns integer
language plpgsql security invoker set search_path = ''
as $$
declare
  v_label  public.shop_catalog_labels%rowtype;
  v_new    text := trim(coalesce(p_new_name, ''));
  v_count  integer;
begin
  select * into v_label from public.shop_catalog_labels where id = p_label_id;
  if not found or not private.is_shop_owner(v_label.shop_id) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if char_length(v_new) not between 1 and 50 then
    raise exception 'Names must be 1 to 50 characters' using errcode = '23514';
  end if;
  if exists (select 1 from public.shop_catalog_labels l
             where l.shop_id = v_label.shop_id and l.kind = v_label.kind
               and lower(l.name) = lower(v_new) and l.id <> v_label.id) then
    raise exception 'This name is already in the list' using errcode = '23505';
  end if;

  if v_label.kind = 'collection' then
    update public.products p set collection = v_new
     where p.shop_id = v_label.shop_id and lower(p.collection) = lower(v_label.name);
  else
    update public.products p
       set categories = array(
             select distinct on (lower(x.c)) x.c
             from (select case when lower(c) = lower(v_label.name) then v_new else c end as c, o
                   from unnest(p.categories) with ordinality as u(c, o)) x
             order by lower(x.c), x.o)
     where p.shop_id = v_label.shop_id
       and exists (select 1 from unnest(p.categories) c where lower(c) = lower(v_label.name));
  end if;
  get diagnostics v_count = row_count;

  perform set_config('app.rename_catalog_label', 'on', true);
  update public.shop_catalog_labels set name = v_new where id = v_label.id;
  perform set_config('app.rename_catalog_label', 'off', true);
  return v_count;
end;
$$;

-- Delete a collection/category and remove it from the products that use
-- it (the products themselves stay). Returns how many products changed.
create function public.delete_catalog_label(p_label_id uuid)
returns integer
language plpgsql security invoker set search_path = ''
as $$
declare
  v_label  public.shop_catalog_labels%rowtype;
  v_count  integer;
begin
  select * into v_label from public.shop_catalog_labels where id = p_label_id;
  if not found or not private.is_shop_owner(v_label.shop_id) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  if v_label.kind = 'collection' then
    update public.products p set collection = null
     where p.shop_id = v_label.shop_id and lower(p.collection) = lower(v_label.name);
  else
    update public.products p
       set categories = array(select c from unnest(p.categories) with ordinality as u(c, o)
                              where lower(c) <> lower(v_label.name) order by o)
     where p.shop_id = v_label.shop_id
       and exists (select 1 from unnest(p.categories) c where lower(c) = lower(v_label.name));
  end if;
  get diagnostics v_count = row_count;

  perform set_config('app.rename_catalog_label', 'on', true);
  delete from public.shop_catalog_labels where id = v_label.id;
  perform set_config('app.rename_catalog_label', 'off', true);
  return v_count;
end;
$$;

-- Name changes and deletes only from inside the two functions above.
create function private.guard_catalog_label_change()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if current_setting('app.rename_catalog_label', true) is distinct from 'on'
     and current_user in ('authenticated', 'anon') then
    if tg_op = 'DELETE' then
      raise exception 'Use delete_catalog_label() to delete a list name' using errcode = '42501';
    elsif new.name is distinct from old.name or new.kind is distinct from old.kind
          or new.shop_id is distinct from old.shop_id then
      raise exception 'Use rename_catalog_label() to rename a list name' using errcode = '42501';
    end if;
  end if;
  return coalesce(new, old);
end;
$$;
create trigger shop_catalog_labels_guard
  before update or delete on public.shop_catalog_labels
  for each row execute function private.guard_catalog_label_change();

-- The functions update names as the logged-in owner, so the owner needs
-- the column right; the guard above makes sure it only works through them.
grant update (name) on public.shop_catalog_labels to authenticated;
grant delete on public.shop_catalog_labels to authenticated;


-- Save the whole list of favourite option types at once (in the given
-- order), so renames / reorders never clash halfway.
-- p_presets: [{"name": "Size", "values": ["2Y", "3Y"]}, …]
create function public.save_option_presets(p_shop_id uuid, p_presets jsonb)
returns void
language plpgsql security invoker set search_path = ''
as $$
declare
  v_item  jsonb;
  v_pos   integer := 0;
begin
  if p_shop_id is null or not private.is_shop_owner(p_shop_id) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_presets is null or jsonb_typeof(p_presets) <> 'array' then
    raise exception 'Invalid option types' using errcode = '22023';
  end if;
  if jsonb_array_length(p_presets) > 30 then
    raise exception 'You can save at most 30 option types' using errcode = '23514';
  end if;

  delete from public.shop_option_presets where shop_id = p_shop_id;
  for v_item in select value from jsonb_array_elements(p_presets) loop
    if jsonb_typeof(v_item -> 'name') <> 'string' or jsonb_typeof(v_item -> 'values') <> 'array' then
      raise exception 'Invalid option types' using errcode = '22023';
    end if;
    v_pos := v_pos + 1;
    insert into public.shop_option_presets (shop_id, name, "values", position)
    values (p_shop_id, trim(v_item ->> 'name'),
            array(select trim(x) from jsonb_array_elements_text(v_item -> 'values') with ordinality as e(x, o) order by o),
            v_pos);
  end loop;
end;
$$;


-- =====================================================================
-- 7. DELIVERY + PICKUP, saved together (all or nothing)
-- =====================================================================
-- p_fees: {"Beirut": 3, "Akkar": null, …} — null / missing = not available.
create function public.save_delivery_settings(
  p_shop_id             uuid,
  p_delivery_on         boolean,
  p_delivery_mode       text,
  p_delivery_fixed      numeric,
  p_fees                jsonb,
  p_free_delivery_on    boolean,
  p_free_delivery_above numeric,
  p_delivery_note       text,
  p_pickup_on           boolean,
  p_pickup_note         text
)
returns void
language plpgsql security invoker set search_path = ''
as $$
declare
  v_mode  text := coalesce(p_delivery_mode, 'fixed');
  v_gov   record;
  v_fee   numeric;
begin
  if p_shop_id is null or not private.is_shop_owner(p_shop_id) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if not coalesce(p_delivery_on, false) and not coalesce(p_pickup_on, false) then
    raise exception 'Your shop needs delivery or pickup, otherwise customers can''t order.'
      using errcode = '23514';
  end if;
  if v_mode not in ('fixed', 'governorate') then
    raise exception 'Please choose a fee type' using errcode = '23514';
  end if;
  if p_fees is not null and jsonb_typeof(p_fees) <> 'object' then
    raise exception 'Invalid delivery fees' using errcode = '22023';
  end if;
  if coalesce(p_free_delivery_on, false) and p_free_delivery_above is null then
    raise exception 'Please type the amount for free delivery' using errcode = '23514';
  end if;

  -- Fees per governorate (always saved, so switching modes keeps them).
  for v_gov in select g.name from public.lebanon_governorates g loop
    v_fee := case when jsonb_typeof(p_fees -> v_gov.name) = 'number'
                  then (p_fees ->> v_gov.name)::numeric end;
    if v_fee is not null and (v_fee < 0 or v_fee > 1000) then
      raise exception 'Delivery fees must be between 0 and 1000' using errcode = '23514';
    end if;
    insert into public.shop_delivery_fees (shop_id, governorate, fee)
    values (p_shop_id, v_gov.name, v_fee)
    on conflict (shop_id, governorate) do update set fee = excluded.fee;
  end loop;

  if coalesce(p_delivery_on, false) and v_mode = 'governorate'
     and not exists (select 1 from public.shop_delivery_fees f
                     where f.shop_id = p_shop_id and f.fee is not null) then
    raise exception 'Type a fee for at least one governorate, or choose one fixed fee.'
      using errcode = '23514';
  end if;

  update public.shops
     set delivery_on         = coalesce(p_delivery_on, false),
         delivery_mode       = v_mode,
         delivery_fixed      = coalesce(p_delivery_fixed, 0),
         free_delivery_on    = coalesce(p_free_delivery_on, false),
         free_delivery_above = p_free_delivery_above,
         delivery_note       = nullif(trim(coalesce(p_delivery_note, '')), ''),
         pickup_on           = coalesce(p_pickup_on, false),
         pickup_note         = nullif(trim(coalesce(p_pickup_note, '')), '')
   where id = p_shop_id;
end;
$$;


-- =====================================================================
-- 8. STORAGE: bucket "shop-assets" (logos, share images)
-- =====================================================================
-- Public read (anyone can load the picture by its URL). Max 300 KB,
-- JPG/PNG/WebP only. Files: "<shop id>/logo-<random>.webp".
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('shop-assets', 'shop-assets', true, 307200, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- True when the file is in a folder of a shop the user OWNS, with an
-- allowed name. Never errors on strange names (returns false).
create function private.can_manage_shop_asset(p_name text)
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_folder text := split_part(coalesce(p_name, ''), '/', 1);
begin
  if coalesce(p_name, '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(logo|share)-[A-Za-z0-9-]{1,64}\.(webp|jpg|png)$' then
    return false;
  end if;
  return private.is_shop_owner(v_folder::uuid);
end;
$$;
revoke all on function private.can_manage_shop_asset(text) from public, anon, authenticated;
grant execute on function private.can_manage_shop_asset(text) to authenticated;

create policy "Owners can view their shop assets"
  on storage.objects for select to authenticated
  using (bucket_id = 'shop-assets' and private.can_manage_shop_asset(name));
create policy "Owners can upload their shop assets"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'shop-assets' and private.can_manage_shop_asset(name));
create policy "Owners can replace their shop assets"
  on storage.objects for update to authenticated
  using (bucket_id = 'shop-assets' and private.can_manage_shop_asset(name))
  with check (bucket_id = 'shop-assets' and private.can_manage_shop_asset(name));
create policy "Owners can delete their shop assets"
  on storage.objects for delete to authenticated
  using (bucket_id = 'shop-assets' and private.can_manage_shop_asset(name));


-- =====================================================================
-- Function permissions (logged-in users; each function checks the role)
-- =====================================================================
revoke all on function private.is_valid_preset_values(text[]) from public, anon, authenticated;
grant execute on function private.is_valid_preset_values(text[]) to authenticated, service_role;
revoke all on function private.check_settings_list_limits() from public, anon, authenticated;
revoke all on function private.guard_catalog_label_change() from public, anon, authenticated;

revoke all on function public.catalog_label_usage(uuid) from public, anon, authenticated;
revoke all on function public.rename_catalog_label(uuid, text) from public, anon, authenticated;
revoke all on function public.delete_catalog_label(uuid) from public, anon, authenticated;
revoke all on function public.save_option_presets(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.save_option_presets(uuid, jsonb) to authenticated, service_role;
revoke all on function public.save_delivery_settings(uuid, boolean, text, numeric, jsonb, boolean, numeric, text, boolean, text)
  from public, anon, authenticated;
grant execute on function public.catalog_label_usage(uuid) to authenticated, service_role;
grant execute on function public.rename_catalog_label(uuid, text) to authenticated, service_role;
grant execute on function public.delete_catalog_label(uuid) to authenticated, service_role;
grant execute on function public.save_delivery_settings(uuid, boolean, text, numeric, jsonb, boolean, numeric, text, boolean, text)
  to authenticated, service_role;


-- =====================================================================
-- 9. PLACE_ORDER: closed shop, minimum order, the shop's own max pieces
-- (same function as before; only these three checks are new)
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
  p_items            jsonb,     -- [{"product_id": "…", "variant_id": "…" | null, "quantity": 2}]
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
           sum((e ->> 'quantity')::numeric::integer)   as quantity
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
  end loop;

  -- The shop's own limit (1–50, default 20).
  if v_pieces > v_shop.max_pieces then
    raise exception 'You can order at most % pieces in one order (your cart has %)', v_shop.max_pieces, v_pieces;
  end if;

  if jsonb_array_length(v_problems) > 0 then
    -- Nothing has been saved. The storefront shows this list and fixes the cart.
    return jsonb_build_object(
      'ok',             false,
      'error',          'stock',
      'message',        array_to_string(v_messages, '. ') || '.',
      'stock_problems', v_problems
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
