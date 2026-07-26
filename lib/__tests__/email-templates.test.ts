import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import * as emails from "@/lib/emails/render"

/**
 * Two things this file guards.
 *
 * 1. Every template renders to real HTML with a real subject. React Email
 *    templates fail at RUNTIME, not typecheck — a bad prop shows up as
 *    "undefined" in someone's inbox, not as a compile error.
 *
 * 2. `sendInvitationEmail` stays configured on the better-auth organization
 *    plugin. Before 2026-07-26 it was absent: `inviteTeamMember` wrote an
 *    Invitation row via `auth.api.createInvitation` and NO email was ever
 *    sent — the `teamInviteEmail` template existed with zero callers, and
 *    the invite dialog cheerfully reported "Sending…". better-auth only
 *    mails when that option is present, so deleting it fails silently and
 *    invisibly. That is exactly the shape that needs a test.
 */

const ROOT = join(import.meta.dirname, "..", "..")

const LEAKS = ["undefined", "[object Object]", "NaN"]

function assertClean(name: string, r: { subject: string; html: string; text: string }) {
  expect(r.subject.length, `${name}: empty subject`).toBeGreaterThan(0)
  expect(r.html.length, `${name}: empty html`).toBeGreaterThan(200)
  expect(r.text.length, `${name}: empty plain-text part`).toBeGreaterThan(0)
  for (const leak of LEAKS) {
    expect(r.html.includes(leak), `${name}: rendered "${leak}" into the HTML`).toBe(
      false,
    )
  }
  // Brand mark + CTA colour — catches the layout silently losing its theme.
  expect(r.html, `${name}: missing brand colour`).toContain("#cf3a21")
}

describe("email templates render", () => {
  it("team invite", async () => {
    const r = await emails.teamInviteEmail({
      inviterName: "Vick Kumar",
      orgName: "Lighthouse Surgical Center",
      inviteUrl: "https://tydei.com/accept-invitation?id=abc",
      roleLabel: "Admin",
    })
    assertClean("team-invite", r)
    expect(r.subject).toBe("Vick Kumar invited you to Lighthouse Surgical Center on TYDEi")
    expect(r.html).toContain("https://tydei.com/accept-invitation?id=abc")
  })

  it("reset password", async () => {
    const r = await emails.resetPasswordEmail({ url: "https://tydei.com/r/1", userName: "Vick" })
    assertClean("reset-password", r)
    expect(r.html).toContain("https://tydei.com/r/1")
  })

  it("verify email", async () => {
    const r = await emails.verifyEmailEmail({ url: "https://tydei.com/v/1", userName: "Vick" })
    assertClean("verify-email", r)
    expect(r.html).toContain("https://tydei.com/v/1")
  })

  it("change-email confirmation names the new address", async () => {
    const r = await emails.changeEmailConfirmationEmail({
      url: "https://tydei.com/v/change",
      newEmail: "new@example.com",
      userName: "Vick",
    })
    assertClean("change-email-confirmation", r)
    // The whole point of this mail is that the CURRENT inbox can see which
    // address the account would move to before approving.
    expect(r.html).toContain("new@example.com")
    expect(r.html).toContain("https://tydei.com/v/change")
  })

  it("alert notification keeps its subject contract", async () => {
    const r = await emails.alertNotificationEmail({
      title: "Off-contract spend detected",
      description: "12 line items were purchased off-contract.",
      severity: "high",
      alertType: "off_contract",
      actionLink: "/dashboard/alerts",
      contractName: "Medtronic MSA",
      vendorName: "Medtronic",
    })
    assertClean("alert-notification", r)
    expect(r.subject).toBe("[TYDEi Alert] Off-Contract Spending: Off-contract spend detected")
  })

  it("renewal reminder keeps its subject contract", async () => {
    const r = await emails.renewalReminderEmail(
      {
        contractName: "Stryker Ortho MSA",
        vendorName: "Stryker",
        expirationDate: "Sep 30, 2026",
        contractId: "c1",
      },
      28,
    )
    assertClean("renewal-reminder", r)
    expect(r.subject).toBe('[TYDEi] Contract "Stryker Ortho MSA" expires in 28 days')
  })

  it("weekly digest keeps its subject contract", async () => {
    const r = await emails.weeklyDigestEmail({
      facilityName: "Lighthouse Surgical Center",
      newAlerts: 7,
      activeContracts: 34,
      expiringContracts: 3,
      totalSpend: 1_284_000,
      rebatesEarned: 96_500,
      offContractSpend: 41_200,
    })
    assertClean("weekly-digest", r)
    expect(r.subject).toBe("[TYDEi] Weekly Summary for Lighthouse Surgical Center")
    expect(r.html).toContain("$1,284,000")
  })

  it("pending contract submitted / decision keep their subject contracts", async () => {
    const base = {
      contractName: "Arthrex Sports Med",
      vendorName: "Arthrex",
      facilityName: "Lighthouse Surgical Center",
      pendingId: "p1",
    }
    const submitted = await emails.pendingContractSubmittedEmail(base)
    assertClean("pending-submitted", submitted)
    expect(submitted.subject).toBe("[TYDEi] Arthrex submitted a contract for review")

    const decision = await emails.pendingContractDecisionEmail({
      ...base,
      decision: "revision_requested",
      reviewNotes: "Tier 3 threshold needs to be $2.5M.",
    })
    assertClean("pending-decision", decision)
    expect(decision.subject).toBe("[TYDEi] Submission needs revision: Arthrex Sports Med")
  })

  it("contact form escapes user-supplied markup", async () => {
    const r = await emails.contactFormEmail({
      name: "Jane",
      email: "jane@x.org",
      company: null,
      message: '<script>alert("xss")</script> & "quoted"',
    })
    assertClean("contact-form", r)
    // React escapes by construction; the raw tag must never reach the inbox.
    expect(r.html).not.toContain("<script>")
    expect(r.html).toContain("&lt;script&gt;")
  })
})

describe("invitation delivery stays wired", () => {
  it("the organization plugin still configures sendInvitationEmail", () => {
    const src = readFileSync(join(ROOT, "lib", "auth-server.ts"), "utf8")
    expect(
      /sendInvitationEmail\s*:/.test(src),
      "lib/auth-server.ts no longer configures sendInvitationEmail on the " +
        "organization plugin. Without it better-auth writes the Invitation " +
        "row and sends NOTHING — invites silently never arrive.",
    ).toBe(true)
    expect(src).toContain("teamInviteEmail")
  })
})
