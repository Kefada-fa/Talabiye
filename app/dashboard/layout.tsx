import type { Metadata } from "next";
import { Suspense } from "react";
import { fill, t } from "@/lib/i18n";
import { backofficeFontVars } from "@/lib/backoffice/fonts";
import { getDashboardContext, getDashboardSummary } from "@/lib/backoffice/context";
import { AppShell } from "@/components/backoffice/app-shell";
import { Card } from "@/components/backoffice/ui";
import { logOutAction } from "@/lib/auth/actions";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/**
 * Back office frame. Every /dashboard page is protected on the server:
 *   - not logged in          → /login   (getDashboardContext redirects)
 *   - logged in, no shop yet  → friendly "No shop yet" page
 *   - member                  → sidebar / phone bars + the page
 */
export default function DashboardLayout({ children }: LayoutProps<"/dashboard">) {
  return (
    <div className={`${backofficeFontVars} flex min-h-full flex-1 flex-col bg-bo-page font-bo-body text-bo-ink`}>
      <Suspense fallback={<ShellSkeleton />}>
        <DashboardShell>{children}</DashboardShell>
      </Suspense>
    </div>
  );
}

async function DashboardShell({ children }: { children: React.ReactNode }) {
  const ctx = await getDashboardContext();

  if (!ctx.current) {
    return (
      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <Card className="max-w-md text-center">
          <h1 className="font-bo-heading text-2xl font-semibold">{t.backoffice.noShop.title}</h1>
          <p className="mt-2 text-bo-muted">{fill(t.backoffice.noShop.text, { email: ctx.user.email ?? "" })}</p>
          <form action={logOutAction} className="mt-6">
            <button type="submit" className="min-h-11 rounded-xl border border-bo-border px-5 font-semibold hover:bg-bo-page">
              {t.backoffice.nav.logOut}
            </button>
          </form>
        </Card>
      </main>
    );
  }

  const summary = await getDashboardSummary(ctx.current.id);

  return (
    <AppShell
      key={ctx.current.id}
      shop={{ id: ctx.current.id, name: ctx.current.name, slug: ctx.current.slug, logoUrl: ctx.current.logoUrl }}
      shops={ctx.shops.map((s) => ({ id: s.id, name: s.name }))}
      initialUnconfirmed={summary.unconfirmedCount}
    >
      {children}
    </AppShell>
  );
}

function ShellSkeleton() {
  return (
    <div className="flex flex-1">
      <div className="hidden w-64 shrink-0 bg-bo-sidebar md:block" />
      <div className="flex-1 p-8">
        <div className="h-8 w-48 animate-pulse rounded-lg bg-bo-border" />
      </div>
    </div>
  );
}
