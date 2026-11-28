import Image from "next/image";
import { brand } from "@/config/brand";
import { backofficeFontVars } from "@/lib/backoffice/fonts";

/** Centered card used by the login / password pages (platform look, not a shop's). */
export function AuthCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <main
      className={`${backofficeFontVars} flex flex-1 items-center justify-center bg-bo-page px-4 py-10 font-bo-body text-bo-ink`}
    >
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2">
          <Image src={brand.logo.src} alt={brand.logo.alt} width={36} height={36} priority />
          <span className="font-bo-heading text-xl font-bold">{brand.name}</span>
        </div>
        <div className="rounded-bo-card border border-bo-border bg-bo-card p-6 shadow-sm">
          <h1 className="font-bo-heading text-2xl font-semibold">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-bo-muted">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </div>
      </div>
    </main>
  );
}

export const boInputClass =
  "min-h-11 w-full rounded-xl border border-bo-border bg-white px-4 py-2.5 text-base text-bo-ink outline-none focus:border-bo-accent focus:ring-2 focus:ring-bo-accent/25";

export const boButtonClass =
  "inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-bo-accent px-4 text-base font-semibold text-white transition-colors hover:bg-bo-accent-hover disabled:opacity-60";

export function FormError({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-xl border border-status-refused-fg/20 bg-status-refused-bg p-3 text-sm text-status-refused-fg">
      {message}
    </p>
  );
}
