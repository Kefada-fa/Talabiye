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
  orders/hour, 3 unconfirmed per phone, 4 per phone per 24h; max 20 pieces).
  Stock problems come back as `{ok:false, stock_problems:[…]}`.
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
- Private (members only, never public): `product_costs`,
  `shop_private_settings`, `money_entries`, `order_history`.
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
  settings, Step 11) — the demo's $60 / "no Akkar" are just seed examples.
- Shop public settings (columns on `shops`): delivery_on, pickup_on, delivery_mode,
  delivery_fixed, free_delivery_*, delivery_note, description_on, policy_on,
  policy_text, low_stock_at, socials, colors, hero_text, reviews_on.
  Per-governorate fees: `shop_delivery_fees` (no row / null = no delivery).
- Product photos: `product_photos.storage_path` → `lib/storefront/photos.ts`
  (Supabase Storage bucket `product-photos`, set up in a later step).
- The full Kefada-style storefront comes in Step 10; Step 6 kept UI changes
  minimal.

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
- **No shop sign-up yet:** shops/owners are created by admin SQL for now.
- **Imports (Step 20):** `display_number` accepts imported numbers like
  OLD-0001, but imported orders still take the next `order_number`; the
  import step must decide how old numbers and statuses are inserted (the
  status guard only allows unconfirmed/pending on insert).
- **Stock back for deleted options:** if an option is deleted, its order
  lines lose `variant_id`; cancelling such an order can't return that stock.
- **Photos:** the Supabase Storage bucket `product-photos` and uploads are
  not set up yet (placeholders are shown).
- **Before going live:** remove or protect the `/health` page.
- **Cart prices can be stale** (saved when added); the success page and
  WhatsApp message show the real database totals. Later: refresh cart
  prices/stock from the server on the cart page.
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
