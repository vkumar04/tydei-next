/**
 * Render every TYDEi email with realistic fixture data.
 *
 *   bun run scripts/send-test-emails.ts                  # render + sanity-check only
 *   bun run scripts/send-test-emails.ts --write out/     # also dump .html files to inspect
 *   bun run scripts/send-test-emails.ts --send you@x.com # actually deliver via Resend
 *
 * The render path is the same one production uses (`lib/emails/render.ts`),
 * so a template that renders here renders in the app.
 */
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import * as E from "@/lib/emails/render"
import type { RenderedEmail } from "@/lib/emails/render"

const FIXTURES: { name: string; build: () => Promise<RenderedEmail> }[] = [
  {
    name: "team-invite",
    build: () =>
      E.teamInviteEmail({
        inviterName: "Vick Kumar",
        orgName: "Lighthouse Surgical Center",
        inviteUrl: "https://tydei.com/accept-invitation?id=demo-invitation-id",
        roleLabel: "Admin",
      }),
  },
  {
    name: "verify-email",
    build: () =>
      E.verifyEmailEmail({
        url: "https://tydei.com/verify-email?token=demo",
        userName: "Vick",
      }),
  },
  {
    name: "change-email-confirmation",
    build: () =>
      E.changeEmailConfirmationEmail({
        url: "https://tydei.com/verify-email?token=demo-change",
        newEmail: "vick.new@tydei.com",
        userName: "Vick",
      }),
  },
  {
    name: "reset-password",
    build: () =>
      E.resetPasswordEmail({
        url: "https://tydei.com/reset-password?token=demo",
        userName: "Vick",
      }),
  },
  {
    name: "alert-notification",
    build: () =>
      E.alertNotificationEmail({
        title: "Off-contract spend detected on Medtronic",
        description:
          "12 line items totalling $41,200 were purchased off-contract in the last 30 days.",
        severity: "high",
        alertType: "off_contract",
        actionLink: "/dashboard/alerts",
        contractName: "Medtronic Master Supply Agreement 2026",
        vendorName: "Medtronic",
      }),
  },
  {
    name: "renewal-reminder",
    build: () =>
      E.renewalReminderEmail(
        {
          contractName: "Stryker Orthopaedics MSA",
          vendorName: "Stryker",
          expirationDate: "September 30, 2026",
          contractId: "demo-contract-id",
        },
        28,
      ),
  },
  {
    name: "weekly-digest",
    build: () =>
      E.weeklyDigestEmail({
        facilityName: "Lighthouse Surgical Center",
        newAlerts: 7,
        activeContracts: 34,
        expiringContracts: 3,
        totalSpend: 1_284_000,
        rebatesEarned: 96_500,
        offContractSpend: 41_200,
      }),
  },
  {
    name: "pending-contract-submitted",
    build: () =>
      E.pendingContractSubmittedEmail({
        contractName: "Arthrex Sports Medicine Agreement",
        vendorName: "Arthrex",
        facilityName: "Lighthouse Surgical Center",
        pendingId: "demo-pending-id",
      }),
  },
  {
    name: "pending-contract-decision",
    build: () =>
      E.pendingContractDecisionEmail({
        contractName: "Arthrex Sports Medicine Agreement",
        vendorName: "Arthrex",
        facilityName: "Lighthouse Surgical Center",
        pendingId: "demo-pending-id",
        decision: "revision_requested",
        reviewNotes:
          "Tier 3 threshold should be $2.5M, not $2.0M.\nPlease also confirm the rebate cadence is quarterly.",
      }),
  },
  {
    name: "contact-form",
    build: () =>
      E.contactFormEmail({
        name: "Jane Doe",
        email: "jane@mercyhealth.org",
        company: "Mercy Health",
        message:
          "We run six ASCs and want to consolidate rebate tracking.\nCan we get a demo next week?",
      }),
  },
]

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i === -1 ? undefined : process.argv[i + 1]
}

async function main() {
  const writeDir = argValue("--write")
  const sendTo = argValue("--send")

  if (writeDir) mkdirSync(writeDir, { recursive: true })

  let failed = 0
  const rendered: { name: string; email: RenderedEmail }[] = []

  for (const { name, build } of FIXTURES) {
    const email = await build()
    // A template that interpolates a missing prop leaks these into the
    // markup; catching it here beats finding it in someone's inbox.
    const leaks = ["undefined", "[object Object]", "NaN"].filter((s) =>
      email.html.includes(s),
    )
    const ok = leaks.length === 0 && email.html.length > 0 && email.subject.length > 0
    if (!ok) failed++

    console.log(
      `${ok ? "  ok " : "  BAD"} ${name.padEnd(28)} ` +
        `html=${String(email.html.length).padStart(6)}b ` +
        `text=${String(email.text.length).padStart(5)}b  ` +
        `${leaks.length ? `LEAKS:${leaks.join(",")} ` : ""}` +
        `"${email.subject}"`,
    )

    if (writeDir) writeFileSync(join(writeDir, `${name}.html`), email.html)
    rendered.push({ name, email })
  }

  if (failed > 0) {
    console.error(`\n${failed} template(s) failed to render cleanly.`)
    process.exit(1)
  }
  console.log(`\nAll ${FIXTURES.length} templates rendered cleanly.`)
  if (writeDir) console.log(`HTML written to ${writeDir}`)

  if (!sendTo) return

  const { resend } = await import("@/lib/email")
  if (!resend) {
    console.error("RESEND_API_KEY missing — cannot send.")
    process.exit(1)
  }
  console.log(`\nSending ${rendered.length} test emails to ${sendTo} …`)
  for (const { name, email } of rendered) {
    const res = await resend.emails.send({
      from: "TYDEi <notifications@tydei.com>",
      to: sendTo,
      subject: `[TEST ${name}] ${email.subject}`,
      html: email.html,
      text: email.text,
    })
    if (res.error) {
      console.error(`  FAIL ${name}: ${res.error.message}`)
    } else {
      console.log(`  sent ${name.padEnd(28)} id=${res.data?.id}`)
    }
    // Resend's default rate limit is 2 req/s.
    await new Promise((r) => setTimeout(r, 600))
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
