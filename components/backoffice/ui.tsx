import Link from "next/link";

/** White card with the D1 border + 16px radius. */
export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-bo-card border border-bo-border bg-bo-card p-5 md:p-6 ${className}`}>{children}</div>
  );
}

/** Page title (hidden on phones, where the top bar shows it). */
export function PageTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-6 hidden md:block">
      <h1 className="font-bo-heading text-3xl font-semibold tracking-tight">{title}</h1>
      {subtitle && <p className="mt-1 text-bo-muted">{subtitle}</p>}
    </div>
  );
}

/** Friendly "this page comes later" card. */
export function ComingSoonCard({ label, text }: { label: string; text: string }) {
  return (
    <Card className="flex flex-col gap-2">
      <span className="w-fit rounded-full bg-bo-attention-bg px-2.5 py-1 text-xs font-semibold text-bo-attention-text">
        {label}
      </span>
      <p className="text-base text-bo-ink">{text}</p>
    </Card>
  );
}

/** Teal text link, at least 44px tall. */
export function TextLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="inline-flex min-h-11 items-center font-semibold text-bo-accent hover:text-bo-accent-hover hover:underline">
      {children}
    </Link>
  );
}
