import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { t } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { AuthCard, boButtonClass } from "@/components/backoffice/auth-card";
import { ResetPasswordForm } from "@/components/backoffice/auth-forms";

export const metadata: Metadata = { title: t.auth.resetTitle, robots: { index: false } };

/** Reached from the reset email (via /auth/confirm, which logs the user in). */
export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <AuthCard title={t.auth.resetTitle}>
          <p className="text-sm text-bo-muted">{t.common.loading}</p>
        </AuthCard>
      }
    >
      <ResetLoader />
    </Suspense>
  );
}

async function ResetLoader() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();

  if (!data?.claims?.sub) {
    return (
      <AuthCard title={t.auth.linkExpiredTitle} subtitle={t.auth.linkExpiredText}>
        <Link href="/forgot-password" className={boButtonClass}>
          {t.auth.askNewLink}
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={t.auth.resetTitle}>
      <ResetPasswordForm />
    </AuthCard>
  );
}
