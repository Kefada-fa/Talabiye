# Project: multi-shop ordering platform (working name in `config/brand.ts`)

A multi-shop ordering platform for Lebanese Instagram/WhatsApp sellers.

- Each shop gets a public **storefront** at `<domain>/<shopname>` (e.g. `/shopname`).
- Each shop gets a **back office** to manage its products and its
  **cash-on-delivery (COD)** orders.
- Customers are mostly on phones → **mobile-first** design.
- All prices are in **USD**.
- **Any kind of shop** (clothes, toys, supplements, electronics…), so never
  assume "sizes": products have optional options with a custom name
  (`products.option_label`, e.g. "Size", "Flavor", "Color").
- **Future goal: a "mall"** — a public directory where visitors browse all
  listed shops by category and open any storefront. Not built yet, but keep
  designs compatible (`shop_categories`, `shops.is_listed`, public catalog
  readable across shops). Orders stay per shop.

The product name is temporary. The current name, tagline, logo, domain and
colors live in `config/brand.ts`.

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
- The public creates orders only via `place_order()`; `delivery_outcomes`
  is never granted to `anon`/`authenticated` (use `get_phone_risk()`).
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
- Checkout: server action `app/[slug]/checkout/actions.ts` → `place_order`.
  Has a honeypot field (`website`). The success page shows ONLY the receipt
  from a short-lived httpOnly cookie scoped to that order's path — it never
  reads orders from the DB, so other order numbers reveal nothing.

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
`lib/supabase/admin.ts`, bypasses RLS — only for the sender), `RESEND_API_KEY`.
Never `NEXT_PUBLIC_`.

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
- **Order spam:** `place_order` is public and has no rate limit yet. Add rate
  limiting (e.g. per IP / per phone) before launch.
- **Phone lookups:** any member of an active shop can call `get_phone_risk`
  for any number. Add per-user rate limiting before launch.
- **Never pre-fill customer details by phone on public pages:** `customers`
  stores names/addresses; showing them to anyone who types a phone number
  would leak personal data.
- **Stock is not given back** when an order is cancelled or refused yet
  (to do with order management).
- **No shop sign-up yet:** shops/owners are created by admin SQL for now.
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
