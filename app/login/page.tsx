import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { safeNextPath } from "@/lib/auth/redirect";
import { t } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { AuthCard } from "@/components/backoffice/auth-card";
import { LoginForm } from "@/components/backoffice/auth-forms";

export const metadata: Metadata = { title: t.auth.logIn, robots: { index: false } };

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <AuthCard title={t.auth.loginTitle} subtitle={t.auth.loginSubtitle}>
      <Suspense fallback={<p className="text-sm text-bo-muted">{t.common.loading}</p>}>
        <LoginLoader searchParams={searchParams} />
      </Suspense>
    </AuthCard>
  );
}

async function LoginLoader({ searchParams }: { searchParams: PageProps<"/login">["searchParams"] }) {
  const params = await searchParams;
  const next = safeNextPath(typeof params.next === "string" ? params.next : null);

  // Already logged in → straight to the back office.
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (data?.claims?.sub) redirect(next);

  return <LoginForm next={next} />;
}
