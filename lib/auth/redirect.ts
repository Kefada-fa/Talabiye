/**
 * Only allow "next" redirects inside the back office, so a crafted login
 * link (…/login?next=https://evil.example) can't send users elsewhere.
 */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || typeof next !== "string") return "/dashboard";
  if (!next.startsWith("/dashboard") && next !== "/reset-password") return "/dashboard";
  if (next.startsWith("//") || next.includes("\\")) return "/dashboard";
  return next;
}

/** The public address of this app (for links in emails). */
export function appUrl(): string {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}
