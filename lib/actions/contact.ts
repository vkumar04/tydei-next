"use server"

import { headers } from "next/headers"
import { contactSchema, type ContactInput } from "@/lib/validators"
import { sendEmail } from "@/lib/email"
import { rateLimit } from "@/lib/rate-limit"

const SUPPORT_INBOX = "support@tydei.com"

/** Escape user-supplied text before interpolating into the notification HTML. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

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
  const hdrs = await headers()
  const ip =
    hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    hdrs.get("x-real-ip") ||
    "unknown"
  const { success } = rateLimit(`contact:${ip}`, 3, 60_000)
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
    await sendEmail({
      to: SUPPORT_INBOX,
      subject: `New contact form message from ${name}`,
      html: `
        <h2>New contact form submission</h2>
        <p><strong>Name:</strong> ${escapeHtml(name)}</p>
        <p><strong>Email:</strong> ${escapeHtml(email)}</p>
        ${company ? `<p><strong>Company:</strong> ${escapeHtml(company)}</p>` : ""}
        <p><strong>Message:</strong></p>
        <p style="white-space:pre-wrap">${escapeHtml(message)}</p>
      `,
    })
    return { ok: true }
  } catch (err) {
    console.error("[submitContactForm]", err, { email, company })
    return {
      ok: false,
      error: "We couldn't send your message right now. Please email support@tydei.com directly.",
    }
  }
}
