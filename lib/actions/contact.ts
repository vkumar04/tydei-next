"use server"

import { contactSchema, type ContactInput } from "@/lib/validators"
import { sendEmail } from "@/lib/email"
import { rateLimit } from "@/lib/rate-limit"
import { clientIp } from "@/lib/actions/request-ip"

const SUPPORT_INBOX = "support@tydei.com"

// The hand-rolled escapeHtml() that used to live here is gone: the
// contact-form body is now a React Email template, and React escapes
// interpolated text by construction. Do not reintroduce string-built
// HTML for attacker-supplied input.

export interface ContactResult {
  ok: boolean
  error?: string
}

/**
 * Handle a submission from the public marketing contact form. Validates the
 * payload server-side (never trust the client), then emails the support inbox
 * via Resend. Returns a typed result rather than throwing so the client form
 * can render an inline error without tripping the Server Components overlay.
 */
export async function submitContactForm(input: ContactInput): Promise<ContactResult> {
  // Public, unauthenticated surface that sends email on every call — rate
  // limit by client IP to blunt spam / Resend-quota abuse (2026-06-18 audit).
  const { success } = rateLimit(`contact:${await clientIp()}`, 3, 60_000)
  if (!success) {
    return {
      ok: false,
      error: "Too many messages — please wait a minute and try again.",
    }
  }

  const parsed = contactSchema.safeParse(input)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return {
      ok: false,
      error: first ? `${first.path.join(".") || "form"}: ${first.message}` : "Invalid form submission.",
    }
  }

  const { name, email, company, message } = parsed.data

  try {
    const { contactFormEmail } = await import("@/lib/emails/render")
    const { subject, html, text } = await contactFormEmail({
      name,
      email,
      company,
      message,
    })
    await sendEmail({ to: SUPPORT_INBOX, subject, html, text })
    return { ok: true }
  } catch (err) {
    console.error("[submitContactForm]", err, { email, company })
    return {
      ok: false,
      error: "We couldn't send your message right now. Please email support@tydei.com directly.",
    }
  }
}
