# Project: multi-shop ordering platform (working name in `config/brand.ts`)

A multi-shop ordering platform for Lebanese Instagram/WhatsApp sellers.

- Each shop gets a public **storefront** at `<domain>/<shopname>` (e.g. `/shopname`).
- Each shop gets a **back office** to manage its products and its
  **cash-on-delivery (COD)** orders.
- Customers are mostly on phones → **mobile-first** design.
- All prices are in **USD**.
- **Any kind of shop** (clothes, toys, supplements, electronics…) — see
  "Product-neutral rules" below.
- **Future goal: a "mall"** — a public directory where visitors browse all
  listed shops by category and open any storefront. Not built yet, but keep
  designs compatible (`shop_categories`, `shops.is_listed`, public catalog
  readable across shops). Orders stay per shop.

The product name is temporary. The current name, tagline, logo, domain and
colors live in `config/brand.ts`.

The real **Kefada** back office (kids clothing; Google Sheet + Apps Script:
Products, Costs, Invoices, InvoiceLines, InvoiceHistory, Money, Settings,
Visits) is being rebuilt here, multi-shop and for any product.

## Product-neutral rules (always, every step)

This platform is for ANY kind of product (clothes, toys, supplements,
cosmetics, food, accessories, electronics…). **Kefada is the reference for
FEATURES only, never for product rules.**

- **Options are generic.** Each product has 0, 1 or 2 option types named by
  the seller (Size, Color, Flavor, Weight, Model…) — `product_option_types`
  (position 1/2) and ordered `product_option_values`. Stock and an optional
  own price live on each value or combination (`product_variants`,
  `value1_id` / `value2_id`). Never assume "Size".
- Products with no options have one stock count (`products.stock`;
  null = not tracked / unlimited).
- **Optional product fields** — brand, expiry_date, barcode, weight (free
  text, e.g. "1 kg") — are all nullable, never required.
- **Collections and categories are shop-defined free lists**
  (`products.collection` text, `products.categories` text[] — an item can be
  in several, e.g. Boys + Girls).
- **Any text or error message uses the option's own name**, e.g.
  "Not enough stock for Flavor: Chocolate", "Please choose Color and Size".
- Prices: an option's own price wins; otherwise `sale_price` (must be > 0 and
  < price); otherwise `price`. Order lines keep `list_price` (before sale).

## Tech stack

- **Next.js** (App Router, TypeScript) — pages live in `app/`
- **Supabase** — Postgres database + authentication. Client helpers in
  `lib/supabase/`: `client.ts` (browser, "use client" code) and `server.ts`
  (server components / server actions; `await createClient()`). Settings come
  from `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
- **Tailwind CSS** — styling; brand colors are available as
  `bg-brand-primary`, `text-brand-accent`, `text-brand-on-primary`, etc.

## Database

- Schema changes are SQL files in `supabase/migrations/` (named
  `YYYYMMDDHHMMSS_description.sql`). Never edit a migration that has
  already been run — add a new one instead. The user runs them in the
  Supabase SQL Editor.
- `supabase/seed.sql` creates the demo shop `kefada-demo` (re-runnable).
- RLS is on for every table, and API grants are explicit (auto-grant is off
  in the Supabase project): every new table/function needs its own GRANTs.
- **`place_order()` is SERVER-ONLY** (service_role): the checkout server
  action calls it with the admin client, after its honeypot + 4-second
  checks. It decides prices, delivery fee (fixed or per governorate, free
  above the threshold), stock and spam limits (per shop: 25 website
  orders/hour, 3 unconfirmed per phone, 4 per phone per 24h; max pieces =
  the shop's own `shops.max_pieces`, 1–50, default 20). It also refuses
  closed shops (`accepting_orders = false` → the shop's `closed_message`)
  and carts below `min_order_amount` (subtotal, before delivery:
  "Minimum order is $15."). Stock problems come back as
  `{ok:false, stock_problems:[…]}`.
- **Never charge a price the customer didn't see:** the checkout sends each
  cart line's `expected_price` (the unit price shown in the cart). If the
  real price differs (price edited, sale started/ended, option's own price),
  place_order saves NOTHING and returns `{ok:false, error:'prices',
  price_changes:[{…, old_price, new_price, list_price}]}` (with stock
  problems too: error 'stock', both lists). Checkout lists "was $X, now $Y";
  "Update my cart" writes the new prices into the cart; the customer orders
  again.
- **Open/closed:** `shops.accepting_orders` is the OWNER's holiday switch;
  `shops.is_active` stays a PLATFORM decision (suspension) — owners can't
  change `is_active`, `is_listed`, `category_id`, `slug` or `logo_url`.
- `delivery_outcomes` is never granted to `anon`/`authenticated` (use
  `get_phone_risk()`, members of active shops only).
- **Phones: Lebanese MOBILE numbers only** (03 + 6 digits, or 70/71/76/78/79/81
  + 6 digits), stored as `+961…` by `private.normalize_lb_phone()`
  (mirrored in `lib/phone.ts`).
- **Order statuses** (Kefada invoices):
  `unconfirmed → pending → paid`, plus `cancelled` (needs a reason) and
  `refused`. Website orders start `unconfirmed` (stock held); manual
  invoices (`source = 'manual'`, Step 12) start `pending`. paid, cancelled,
  refused are final. Guard: `private.guard_order_status()`.
  Members change status ONLY via `confirm_order`, `mark_paid`,
  `cancel_order(reason)`, `mark_refused` (cancel/refused give stock back;
  history + delivery outcomes are written by triggers).
- **Step 12 must add `edit_order()`** (SECURITY DEFINER, members): editing a
  PAID invoice moves it back to `pending`. The guard only allows paid →
  pending when the function sets `set_config('app.reopen_paid_order', 'on',
  true)` inside its own transaction — never via a direct update. It must
  also recalculate totals (total = subtotal − discount + delivery_fee +
  extra_fees; checked at commit by `orders_check_total`) and write history.
- Members can't insert/update orders or order lines directly (only order
  `notes`); manual invoices and edits come as functions in Step 12.
- Order lines keep snapshots: `name`, `code`, `option_label`, `list_price`,
  `unit_price`, `photo`, and `cost` (copied from `product_costs`; filled once
  if missing, then locked).
- Invoice numbers: `orders.display_number` = `<invoice_prefix>-0001`
  (prefix in `shop_private_settings`); `order_number` is the per-shop counter.
- **Costs are OWNERS ONLY** (Step 9): `product_costs` (RLS owners) and the
  `order_items.cost` column (not granted to `authenticated` at all — use
  explicit column lists, never `select *` on order_items; owners will get
  costs via owner-only functions). Staff never see cost, profit or margin.
- Private (members only, never public): `shop_private_settings`,
  `money_entries`, `order_history`, `stock_changes`.
  Server only: `order_review_tokens`, `notification_outbox` writes.
- Reviews: `submit_review()` (server only, with the order's secret review
  token; paid orders, products in the order, one per product per order).
  The public reads only `product_reviews_public` (approved, visible, shop
  has reviews_on) — never `order_id`. UI comes in Steps 10/11.
- `orders.confirm_token` must only ever reach the customer's own phone
  (e.g. a WhatsApp link). Never return it to the browser that placed the order.
- `supabase/tests/security_test.sql` checks the security rules (run it in the
  SQL Editor; every row must say PASS). Re-run it after every migration and
  add tests for every new table or function.

## Storefront

- Routes: `/[slug]` (shop + products), `/[slug]/p/[productId]`,
  `/[slug]/cart`, `/[slug]/checkout`, `/[slug]/order/[orderNumber]`.
- **All UI text lives in `lib/i18n/en.ts`** (use `t` and `fill()` from
  `@/lib/i18n`). Arabic (RTL) / French later = new dictionaries with the
  same keys. Never hard-code UI text in components.
- Catalog data: `lib/storefront/data.ts` (public client, `cache()`d per
  request). With Cache Components, read `params`/cookies/DB inside `<Suspense>`.
- Cart: `lib/cart/cart.ts` — localStorage per shop, all access in try/catch.
  Cart prices are display-only; `place_order` decides real prices/stock.
- Checkout: server action `app/[slug]/checkout/actions.ts` → `place_order`
  (admin client). Spam checks before the DB: honeypot field (`website`) and a
  signed "page shown at" token (`lib/checkout/form-token.ts`; under 4 s =
  refuse). Pickup/delivery, governorate → district dropdowns, policy tick
  box when `shops.policy_on`. The success page shows ONLY the receipt
  from a short-lived httpOnly cookie scoped to that order's path — it never
  reads orders from the DB, so other order numbers reveal nothing.
- **Pickup is a per-shop toggle** (`shops.pickup_on`, OFF by default → new
  shops are delivery-only). A shop must keep delivery or pickup on
  (`shops_delivery_or_pickup`). Checkout shows Pickup only when it's on;
  `place_order` refuses pickup otherwise. Free-delivery amount and
  per-governorate availability are each shop's own choice (back-office
  settings) — the demo's $60 / "no Akkar" are just seed examples.
- Shop public settings (columns on `shops`): delivery_on, pickup_on, delivery_mode,
  delivery_fixed, free_delivery_*, delivery_note, pickup_note, description_on,
  policy_on, policy_text, low_stock_at, instagram, facebook, colors, tagline,
  hero_text, description (= link-preview text, max 160), logo_path,
  share_image_path, accepting_orders, closed_message, min_order_amount,
  max_pieces, reviews_on. Per-governorate fees: `shop_delivery_fees` (no row /
  null = no delivery). The shop page's `generateMetadata` builds the link
  preview (Open Graph) from description + share image (or logo).
- Shop colors: `app/[slug]/layout.tsx` (`ShopColors`) overrides the
  `--brand-primary` / `--brand-accent` / `--brand-on-primary` variables on
  that shop's pages (text on the main color: white or near-black, whichever
  reads better). No colors set → platform colors from `config/brand.ts`.
- Closed shop: the shop page shows the message on top, cart/checkout are
  blocked (`lib/storefront/ordering.ts`), and place_order refuses.
- Product photos: `product_photos.storage_path` → `lib/storefront/photos.ts`
  (Supabase Storage bucket `product-photos`, set up in a later step).
- Shop pictures: Storage bucket **`shop-assets`** (public read, 300 KB,
  JPG/PNG/WebP). Files `<shop id>/logo-<uuid>.webp` / `share-<uuid>.webp`;
  upload/replace/delete ONLY by owners of that shop
  (`private.can_manage_shop_asset`). The browser resizes first
  (`lib/settings/image.ts`: logo max 512 px, share image 1200 × 630), uploads
  with the user's session, then `saveShopImageAction` saves the path and
  deletes the old file. URLs: `shopAssetUrl()`.
- The full Kefada-style storefront comes in Step 10; Step 6 kept UI changes
  minimal.

## Back office (/dashboard)

- **Design (approved D1)**: tokens live in ONE place — the `@theme` block
  "BACK-OFFICE DESIGN TOKENS" in `app/globals.css` (`bg-bo-sidebar`,
  `bg-bo-accent`, `text-bo-muted`, `bg-bo-attention-bg`, `rounded-bo-card`,
  `bg-status-*-bg` / `text-status-*-fg`…). Fonts: `lib/backoffice/fonts.ts`
  (`font-bo-heading` Space Grotesk, `font-bo-body` Inter). This is the
  PLATFORM's look; shop branding (storefront) stays separate. Reuse
  `StatusChip`, `Card`, `PageTitle`, `ComingSoonCard` (`components/backoffice/`).
  Buttons/links ≥ 44px tall (`min-h-11`), real `<button>`/`<a>`, labels on inputs.
- **Auth**: Supabase email + password. `/login`, `/forgot-password`,
  `/reset-password`, `/auth/confirm` (email links), actions in
  `lib/auth/actions.ts`. `proxy.ts` refreshes the session and sends
  logged-out `/dashboard` visitors to `/login`. No public sign-up (Step 18).
  `next` redirects are limited to `/dashboard…` (`lib/auth/redirect.ts`).
- **Every /dashboard page** gets `getDashboardContext()` (`lib/backoffice/context.ts`):
  not logged in → `/login`; no shop → "No shop yet"; several shops → switcher,
  last choice in the `bo_shop` cookie (only set if the user is a member).
  All reads use the user's own session (RLS) — never the secret key.
- Home numbers: `shop_dashboard_summary(shop_id)` (security invoker, refuses
  non-members). "This month" = calendar month in **Asia/Beirut** time;
  month sales = paid + pending, **subtotal − discount** (no delivery fee, no
  extra fees).
- The `bo_shop` cookie is only a preference: the server loads the user's
  memberships on every request and the cookie can only pick one of them.
- Reserved shop addresses: every top-level route (dashboard, login, logout,
  forgot-password, reset-password, auth, api, health, admin, settings,
  signup, www, app, help, terms, privacy, cart, checkout…). Any new
  top-level route → add it to the reserved list in a migration + the test. The unconfirmed badge refreshes on every page change and
  every 60 s (`getUnconfirmedCountAction`).
- Phone (< 768px): top bar + bottom tabs (Home, Invoices, Inventory,
  Customers, More). Computer: dark sidebar.
- **Settings** (Step 8): ONE PAGE PER SECTION — `/dashboard/settings/<slug>`
  (list in `lib/settings/sections.ts`). Computer: "Settings" in the sidebar
  opens like a dropdown with the sections in a smaller font. Phone:
  More → Settings shows the list (`/dashboard/settings`), each section has
  "← Settings". Each section is a card with its own Save
  (`components/backoffice/settings/`). OWNERS edit;
  staff see it read-only (`<fieldset disabled>`) — except "My account"
  (password change, every member; the current password is re-checked with a
  separate session-less client). Every save is a server action in
  `app/dashboard/settings/actions.ts`: it takes the shop from
  `getDashboardContext()` (never from the browser), refuses non-owners,
  validates with `lib/settings/validate.ts` (same rules as the form), and
  saves with the user's session (RLS = owners only, plus table checks).
  Delivery + pickup + fees save together via `save_delivery_settings()`;
  option presets via `save_option_presets()`. Unsaved changes warn on
  leaving (tab close + in-app links).
- Private settings (members read, owners change): `shop_private_settings`
  (invoice_prefix 2–5 A–Z/0–9, deposit_on/type/amount/instructions,
  wa_confirm/deposit/review_template — null = default text in en.ts;
  placeholders in `lib/settings/templates.ts`), `shop_notification_settings`
  (max 3 emails, no duplicates).
- Catalog lists: `shop_catalog_labels` (kind collection/category, public read
  for active shops) — rename/delete ONLY via `rename_catalog_label()` /
  `delete_catalog_label()`, which also update `products.collection` /
  `products.categories` (a guard trigger blocks direct name changes).
  `shop_option_presets` (members only): favourite option types with ordered
  values; Step 9 uses them as one-tap presets. "Smart size order":
  `lib/settings/size-order.ts`.
- **Inventory** (Step 9): `/dashboard/inventory` (list: search, filters,
  sort, quick stock), `/new` (add; `?from=<id>` = duplicate: options copied,
  stock boxes EMPTY, no own prices, no photos, no code), `/[id]` (edit,
  photos, quick stock, Who bought it, Stock history). Members add/edit;
  OWNERS delete (orders keep their copies; photo files used by orders stay).
  - One save = `save_product(shop, product|null, data)` (all or nothing:
    item, option types/values, full stock grid, value photos, cost for
    owners only). Each stock box sends `stock_base` (value when the page
    opened): untouched boxes keep the CURRENT stock, a changed box that also
    changed meanwhile is refused ("reload").
  - Changing option types (browser, `lib/inventory/form.ts`): adding a 2nd
    type puts the old stock under its FIRST value; removing a type adds the
    stock up per remaining value; warning + confirm before saving.
  - Quick stock: `change_stock(product, variant, delta, set)` (never below
    0; untracked → "Start counting" = set 0).
  - Stock history `stock_changes`: written ONLY by triggers on
    products/product_variants stock; the reason comes from
    `set_config('app.stock_reason', …)` (save_product = edit, change_stock =
    quick_stock, place_order = order_placed, cancel/refuse = order_cancelled /
    order_refused, with `app.stock_order_id`). Read-only for members.
  - "Who bought it": `product_buyers(product)` (members, no cancelled).
  - Photos: bucket `product-photos` (public read, 300 KB), files
    `<shop>/<product>/<uuid>.webp`, members of that shop only, and only for a
    product of that shop (`private.can_manage_product_photo`). Max photos per
    item = `plan_limits.max_product_photos` by `shops.plan` (ONE place;
    platform-only: shops can read, never change it or their plan). New items:
    photos upload after the item is saved; failures delete the uploaded files.
    `product_option_values.photo_id` = photo per option value (Step 10 shows it).
  - **Photo position on cards** (Step 9b): cards are **4:5 portrait**.
    `product_photos.focus_x / focus_y` (0–100 %, default 50) + `zoom` (1–3,
    default 1) = what shows; the file is never cropped. ALWAYS draw product
    photos on cards with `FocusedPhoto` (`components/photo/focused-photo.tsx`,
    shared by back office + shop page). "Adjust" frame
    (`components/backoffice/inventory/adjust-photo.tsx`) opens after adding
    photos and from each photo's Adjust button; saved by
    `setPhotoFocusAction` (members). Full view: `photo-viewer.tsx`
    (whole photo, swipe/arrows, pinch/double-tap zoom, X/Esc/Back).
- Making someone a shop owner (until shop sign-up exists):
  `supabase/snippets/make_shop_owner.sql` (email typed there, never in code).
  Re-running `seed.sql` removes the demo shop's members → run it again.

## Notifications

How it works:
1. A new order is inserted → trigger `private.enqueue_order_created()` adds
   one `notification_outbox` row per enabled channel + recipient, in the
   SAME transaction (no order can be missed).
   - email: one row per address in `shop_notification_settings.order_emails`
     (if `email_enabled`)
   - push: one row per `device_push_tokens` row of a shop member (if
     `push_enabled`; off for now)
2. After checkout, `after()` runs `processOutbox()` (`lib/notifications/outbox.ts`)
   in the background — never slows down or breaks the checkout.
3. `processOutbox` calls `claim_notifications()` (service_role only; SKIP
   LOCKED, so no double sends), sends, then marks rows `sent`, back to
   `pending` (retry) or `failed` after 3 attempts (`last_error` saved).
4. Email: Resend via `RESEND_API_KEY`; without a key, emails are printed to
   the server console and marked sent. Push: stub in `lib/notifications/push.ts`.

Server-only secrets: `SUPABASE_SECRET_KEY` (admin client
`lib/supabase/admin.ts`, bypasses RLS — only for the notification sender and
the checkout's `place_order` call), `RESEND_API_KEY`, `CHECKOUT_FORM_SECRET`
(optional). Never `NEXT_PUBLIC_`.

Plan (no redesign needed):
- **Web push (PWA):** service worker + VAPID keys; save the browser
  subscription in `device_push_tokens` (platform `web`); implement `sendPush`.
- **Native app push:** the app saves its FCM/APNs (or Expo) token in
  `device_push_tokens` (platform `ios`/`android`); `sendPush` sends via
  FCM/APNs; delete tokens the provider reports as invalid.
- **Scheduled retries:** run `processOutbox()` on a cron (e.g. every minute)
  so failed sends retry without waiting for the next order.
- New event types (e.g. `order.status_changed`, customer emails) = new
  `event_type` value + template; same outbox.

## Known risks / later

- **Refusal-list abuse:** a shop could mark fake "refused" orders to make a
  phone number look risky everywhere. Plan: in `get_phone_risk`, count
  refusals only from **distinct shops**, and only for orders **older than
  24h** (so a just-created fake order doesn't count).
- **Order spam:** done in Step 6 (server-only place_order, honeypot,
  4-second token, per-shop limits). Still missing: a per-IP limit.
- **Phone lookups:** any member of an active shop can call `get_phone_risk`
  for any number. Add per-user rate limiting before launch.
- **Never pre-fill customer details by phone on public pages:** `customers`
  stores names/addresses; showing them to anyone who types a phone number
  would leak personal data.
- **No shop sign-up yet:** shops/owners are created by admin SQL for now
  (`supabase/snippets/make_shop_owner.sql`).
- **Password reset emails** need Supabase → Authentication → URL
  Configuration: Site URL = APP_URL and `<APP_URL>/auth/confirm` in Redirect
  URLs (localhost now, the real domain at launch). Supabase's built-in email
  sender is rate-limited; set up custom SMTP before launch.
- **Imports (Step 20):** `display_number` accepts imported numbers like
  OLD-0001, but imported orders still take the next `order_number`; the
  import step must decide how old numbers and statuses are inserted (the
  status guard only allows unconfirmed/pending on insert).
- **Stock back for deleted options:** if an option is deleted, its order
  lines lose `variant_id`; cancelling such an order can't return that stock.
- **Photos:** `product-photos` and `shop-assets` buckets are set up. The shop
  page doesn't switch photos per option value yet (Step 10).
- **Deposits / WhatsApp templates** are settings only; the invoice buttons
  (Request deposit, Mark deposit paid, send messages) come in Step 11.
- **Unsaved-changes warning** covers tab close and in-app links, not the
  browser's Back button.
- **Before going live:** remove or protect the `/health` page.
- **Cart prices can be stale** on the cart page (saved when added); checkout
  refuses changed prices (see place_order). Later: refresh cart prices/stock
  from the server when the cart page opens.
- **Outbox retries only run after a new checkout** until a cron is added.
- **DB error messages are English only** (place_order); translate later by
  mapping them to error codes.

## Commands

- `npm run dev` — start the dev server at http://localhost:3000
- `npm run build` — production build (also catches type errors)
- `npm run lint` — check code style

## Rules (always follow)

1. **The user is a beginner.** Before each step, explain simply what you are
   about to do and why, then do it.
2. **One feature at a time.** Build one feature, check it works, commit it,
   then move to the next. Don't start features that weren't asked for.
3. **Never put secret keys in code.** Secrets go in `.env.local` (ignored by
   git). List each variable name, with no real value, in `.env.example`.
   Only variables prefixed `NEXT_PUBLIC_` reach the browser — never give that
   prefix to a secret (e.g. the Supabase service-role key).
4. **All branding lives in `config/brand.ts`.** Never hard-code the product
   name, tagline, logo path or brand colors anywhere else — import `brand`
   from `@/config/brand` instead. The logo image file is in `public/`.
5. **Never put the brand name in database table or column names.** Use
   generic names like `shops`, `products`, `orders`.

@AGENTS.md
