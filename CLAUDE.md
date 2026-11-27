# Project: multi-shop ordering platform (working name in `config/brand.ts`)

A multi-shop ordering platform for Lebanese Instagram/WhatsApp sellers.

- Each shop gets a public **storefront** at `<domain>/<shopname>` (e.g. `/shopname`).
- Each shop gets a **back office** to manage its products and its
  **cash-on-delivery (COD)** orders.
- Customers are mostly on phones → **mobile-first** design.
- All prices are in **USD**.

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
