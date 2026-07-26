import { Resend } from "resend"

export const resend = new Resend(process.env.RESEND_API_KEY)

export async function sendEmail({
  to,
  subject,
  html,
  text,
}: {
  to: string
  subject: string
  html: string
  /**
   * Plain-text alternative. Every template rendered through
   * `lib/emails/render.ts` supplies one — a multipart message scores
   * better with spam filters than HTML-only.
   */
  text?: string
}) {
  return resend.emails.send({
    from: "TYDEi <notifications@tydei.com>",
    to,
    subject,
    html,
    text,
  })
}

// `sendReportEmail` was removed 2026-07-26 — it had zero callers across the
// whole repo (audit). Report delivery goes through /api/reports/pdf, which
// returns the document to the browser rather than mailing it. If scheduled
// report delivery is built, add it back with a `reports@tydei.com` from-address
// and route the body through lib/emails/render.ts like every other email.
