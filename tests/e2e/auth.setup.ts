import { test as setup } from "@playwright/test"
import { browserSignIn } from "../support/sign-in"

/**
 * E2E auth setup — runs once before the E2E project, saves three
 * storage states (facility + vendor + admin) so individual tests
 * can pick whichever role they need via `test.use({ storageState })`.
 *
 * 2026-04-26: rewritten to use BROWSER login instead of `request.post`.
 * The previous `request.post(...) → context.storageState(...)` pattern
 * had a known cookie-jar bug — `request` is a separate APIRequestContext,
 * so the cookie set by sign-in never landed in the browser context and
 * saved state.json files had empty cookies. Tests using these states
 * silently ran unauthenticated and hit the login page.
 *
 * 2026-09-21: the login itself moved to tests/support/sign-in.ts, which
 * waits out better-auth's 10-per-60s sign-in limiter instead of letting a
 * 429 surface as an unexplained `waitForURL` timeout.
 */

setup("authenticate as facility user", async ({ page, context }) => {
  await browserSignIn(
    page,
    "demo-facility@tydei.com",
    "demo-facility-2024",
    /\/dashboard/,
  )
  await context.storageState({ path: "tests/e2e/.auth/facility.json" })
})

setup("authenticate as vendor user", async ({ page, context }) => {
  await browserSignIn(
    page,
    "demo-vendor@tydei.com",
    "demo-vendor-2024",
    /\/vendor/,
  )
  await context.storageState({ path: "tests/e2e/.auth/vendor.json" })
})

setup("authenticate as admin user", async ({ page, context }) => {
  await browserSignIn(
    page,
    "demo-admin@tydei.com",
    "demo-admin-2024",
    /\/admin/,
  )
  await context.storageState({ path: "tests/e2e/.auth/admin.json" })
})
