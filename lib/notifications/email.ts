import "server-only";
import { brand } from "@/config/brand";

/**
 * Sends one email.
 *
 * - With RESEND_API_KEY set: sends through Resend (https://resend.com).
 * - Without it (local testing): prints the email to the server console
 *   and reports success, so you can test the whole flow without an account.
 *
 * RESEND_API_KEY is SERVER-ONLY. Never prefix it with NEXT_PUBLIC_.
 * RESEND_FROM_EMAIL must be an address on a domain you verified in Resend.
 * Until you verify one, "onboarding@resend.dev" can only send to the
 * email address of your own Resend account.
 */
export async function sendEmail(options: {
  to: string;
  subject: string;
  text: string;
  html: string;
  idempotencyKey: string; // same key = Resend won't send twice
}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    console.info(
      [
        "",
        "📧 [email — not sent, no RESEND_API_KEY; logged instead]",
        `To:      ${options.to}`,
        `Subject: ${options.subject}`,
        "----------------------------------------",
        options.text,
        "----------------------------------------",
        "",
      ].join("\n"),
    );
    return;
  }

  const fromAddress = process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev";

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": options.idempotencyKey,
    },
    body: JSON.stringify({
      from: `${brand.name} <${fromAddress}>`,
      to: [options.to],
      subject: options.subject,
      text: options.text,
      html: options.html,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Resend error ${res.status}: ${body.slice(0, 500)}`);
  }
}
