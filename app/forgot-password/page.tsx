import type { Metadata } from "next";
import { Suspense } from "react";
import { t } from "@/lib/i18n";
import { AuthCard } from "@/components/backoffice/auth-card";
import { ForgotPasswordForm } from "@/components/backoffice/auth-forms";

export const metadata: Metadata = { title: t.auth.forgotTitle, robots: { index: false } };

export default function ForgotPasswordPage({ searchParams }: PageProps<"/forgot-password">) {
  return (
    <AuthCard title={t.auth.forgotTitle} subtitle={t.auth.forgotSubtitle}>
      <Suspense fallback={<p className="text-sm text-bo-muted">{t.common.loading}</p>}>
        <FormLoader searchParams={searchParams} />
      </Suspense>
    </AuthCard>
  );
}

async function FormLoader({ searchParams }: { searchParams: PageProps<"/forgot-password">["searchParams"] }) {
  const params = await searchParams;
  return <ForgotPasswordForm linkError={params.error === "link"} />;
}
