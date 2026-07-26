import { describe, expect, it, vi, beforeEach } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * Regression coverage for the 2026-07-26 better-auth + email audit.
 *
 * Several of these assert on the SHAPE of lib/auth-server.ts rather than on
 * behaviour. That is deliberate: the bugs found were all "a config option is
 * absent, so better-auth silently does nothing" — there is no runtime error to
 * catch, no failing request, nothing a behavioural test would see. The option
 * either exists or the feature is dead. See each block for the specific
 * failure it encodes.
 */

const ROOT = join(import.meta.dirname, "..", "..")

/**
 * Assert against the RESOLVED better-auth options, not the source text.
 * An earlier draft of this file regex-matched auth-server.ts and a lazy
 * `[\s\S]*?` happily matched an `enabled: true` belonging to a different
 * option block — deleting `changeEmail.enabled` did not fail the test.
 * Reading auth.options removes that whole class of false pass.
 */
interface ResolvedOptions {
  user?: {
    changeEmail?: {
      enabled?: boolean
      sendChangeEmailConfirmation?: unknown
    }
  }
  emailVerification?: { sendOnSignIn?: boolean; sendVerificationEmail?: unknown }
  emailAndPassword?: { requireEmailVerification?: boolean }
  plugins?: { id?: string }[]
}

async function options(): Promise<ResolvedOptions> {
  const { auth } = await import("@/lib/auth-server")
  return auth.options as unknown as ResolvedOptions
}

describe("changeEmail is enabled and double-gated", () => {
  it("user.changeEmail.enabled is true", async () => {
    // Without this, better-auth throws CHANGE_EMAIL_DISABLED
    // (api/routes/update-user.mjs:409) on every attempt, while the
    // "Change email" button ships on BOTH portals' Profile tab.
    const o = await options()
    expect(
      o.user?.changeEmail?.enabled,
      "user.changeEmail.enabled is not true — the Change email button in " +
        "Settings → Profile will fail with CHANGE_EMAIL_DISABLED.",
    ).toBe(true)
  })

  it("sendChangeEmailConfirmation gates the change on the CURRENT address", async () => {
    // Without this, a hijacked session can move the account to an
    // attacker-controlled address with no signal to the real owner.
    const o = await options()
    expect(
      typeof o.user?.changeEmail?.sendChangeEmailConfirmation,
      "sendChangeEmailConfirmation is missing — an email change would only " +
        "require access to a live session, not to the current inbox.",
    ).toBe("function")
  })
})

describe("verification lockout has an escape hatch", () => {
  it("sendOnSignIn re-sends the link on a sign-in attempt", async () => {
    // requireEmailVerification blocks sign-in until verified. Without
    // sendOnSignIn there is no other resend path in the product, so losing
    // the original email permanently bricks the account.
    const o = await options()
    expect(
      o.emailVerification?.sendOnSignIn,
      "emailVerification.sendOnSignIn is not true — a user who loses the " +
        "verification email can never sign in again.",
    ).toBe(true)
    expect(typeof o.emailVerification?.sendVerificationEmail).toBe("function")
  })

  it("requireEmailVerification is still on (the reason the hatch matters)", async () => {
    const o = await options()
    expect(o.emailAndPassword?.requireEmailVerification).toBe(true)
  })
})

describe("invitation delivery stays wired", () => {
  it("sendInvitationEmail is configured on the organization plugin", () => {
    const authServerSrc = readFileSync(join(ROOT, "lib", "auth-server.ts"), "utf8")
    expect(
      /sendInvitationEmail\s*:/.test(authServerSrc),
      "better-auth only mails invitations when this option is present. " +
        "Without it, createInvitation writes a row and sends NOTHING.",
    ).toBe(true)
  })

  it("the invite link points at a route that exists", () => {
    const authServerSrc = readFileSync(join(ROOT, "lib", "auth-server.ts"), "utf8")
    const match = authServerSrc.match(/inviteUrl:\s*`\$\{appUrl\}([^`]*)`/)
    expect(match, "could not find the invite URL template").toBeTruthy()
    const path = match![1]
    // Route group (auth) does not appear in the URL.
    expect(path.startsWith("/accept-invitation")).toBe(true)
    // The page must actually exist, or every invitation 404s — which is
    // exactly what shipped before this audit.
    expect(() =>
      readFileSync(join(ROOT, "app", "(auth)", "accept-invitation", "page.tsx")),
    ).not.toThrow()
  })
})

describe("unauthenticated auth actions are rate limited", () => {
  const authActionsSrc = readFileSync(join(ROOT, "lib", "actions", "auth.ts"), "utf8")

  it.each([
    ["requestPasswordReset", "pwreset:"],
    ["resetPassword", "pwsubmit:"],
    ["resendVerificationEmail", "verifyresend:"],
  ])("%s applies its own limiter", (fn, keyPrefix) => {
    // These call auth.api.* directly. better-auth's limiter runs in its HTTP
    // handler (onRequestRateLimit in api/index.mjs), which a server action
    // never crosses — so the customRules in auth-server.ts do NOT cover them.
    const body = authActionsSrc.slice(
      authActionsSrc.indexOf(`export async function ${fn}`),
    )
    const nextExport = body.indexOf("export async function", 1)
    const scoped = nextExport === -1 ? body : body.slice(0, nextExport)
    expect(scoped.includes("rateLimit("), `${fn} has no rate limit`).toBe(true)
    expect(scoped.includes(keyPrefix), `${fn} limiter key changed`).toBe(true)
  })

  it("invitations are capped per organization", () => {
    const settingsSrc = readFileSync(join(ROOT, "lib", "actions", "settings.ts"), "utf8")
    expect(settingsSrc).toContain("INVITE_LIMIT_PER_HOUR")
    // Both the facility and vendor invite paths send mail.
    const guards = settingsSrc.match(/withinInviteLimit/g) ?? []
    expect(guards.length, "expected both invite actions to be guarded").toBeGreaterThanOrEqual(4)
  })
})

describe("rate limiter behaviour", () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it("blocks past the limit inside the window and keys are independent", async () => {
    const { rateLimit } = await import("@/lib/rate-limit")
    const key = `test-${Math.random()}`
    for (let i = 0; i < 5; i++) {
      expect(rateLimit(key, 5, 60_000).success, `call ${i + 1} should pass`).toBe(true)
    }
    expect(rateLimit(key, 5, 60_000).success, "6th call should be blocked").toBe(false)

    // A different identifier must not inherit the exhausted budget.
    expect(rateLimit(`${key}-other`, 5, 60_000).success).toBe(true)
  })
})

describe("dead code removed", () => {
  it("sendReportEmail is gone (it had zero callers)", () => {
    const emailSrc = readFileSync(join(ROOT, "lib", "email.ts"), "utf8")
    expect(/export\s+async\s+function\s+sendReportEmail/.test(emailSrc)).toBe(false)
  })
})
