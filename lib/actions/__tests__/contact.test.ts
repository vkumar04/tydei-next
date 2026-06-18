import { describe, it, expect, vi, beforeEach } from "vitest"

const sendEmailMock = vi.fn(
  async (_args: { to: string; subject: string; html: string }): Promise<void> =>
    undefined,
)
vi.mock("@/lib/email", () => ({
  sendEmail: (args: { to: string; subject: string; html: string }) =>
    sendEmailMock(args),
}))

// Contact form is IP-rate-limited via next/headers (2026-06-18 audit). Give
// each call a distinct IP so the limiter doesn't accumulate across tests.
vi.mock("next/headers", () => {
  let n = 0
  return {
    headers: async () =>
      new Map<string, string>([["x-forwarded-for", `10.0.0.${++n}`]]),
  }
})

import { submitContactForm } from "@/lib/actions/contact"

const valid = {
  name: "Jane Doe",
  email: "jane@hospital.org",
  company: "Lighthouse Surgical Center",
  message: "We'd like to learn more about rebate tracking.",
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("submitContactForm", () => {
  it("emails the support inbox on a valid submission", async () => {
    const result = await submitContactForm(valid)

    expect(result.ok).toBe(true)
    expect(sendEmailMock).toHaveBeenCalledTimes(1)
    const arg = sendEmailMock.mock.calls[0]![0]
    expect(arg.to).toBe("support@tydei.com")
    expect(arg.subject).toContain("Jane Doe")
    expect(arg.html).toContain("jane@hospital.org")
  })

  it("rejects an invalid email without sending", async () => {
    const result = await submitContactForm({ ...valid, email: "not-an-email" })

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/email/i)
    expect(sendEmailMock).not.toHaveBeenCalled()
  })

  it("rejects a too-short message without sending", async () => {
    const result = await submitContactForm({ ...valid, message: "hi" })

    expect(result.ok).toBe(false)
    expect(sendEmailMock).not.toHaveBeenCalled()
  })

  it("escapes HTML in user input to prevent injection in the email", async () => {
    await submitContactForm({
      ...valid,
      name: "<script>alert(1)</script>",
      message: "Totally legitimate inquiry about contracts & rebates.",
    })

    const arg = sendEmailMock.mock.calls[0]![0]
    expect(arg.html).not.toContain("<script>")
    expect(arg.html).toContain("&lt;script&gt;")
    // Ampersand in the message body is escaped too.
    expect(arg.html).toContain("contracts &amp; rebates")
  })

  it("returns a friendly error when the email provider throws", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    sendEmailMock.mockRejectedValueOnce(new Error("resend down"))

    const result = await submitContactForm(valid)

    expect(result.ok).toBe(false)
    expect(result.error).toContain("support@tydei.com")
    expect(consoleSpy).toHaveBeenCalledWith(
      "[submitContactForm]",
      expect.any(Error),
      expect.objectContaining({ email: valid.email }),
    )
    consoleSpy.mockRestore()
  })
})
