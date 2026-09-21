import { test as setup } from "@playwright/test"
import { browserSignIn } from "../support/sign-in"

/**
 * Authenticate once per role and save cookies for all visual tests.
 * Run with: bunx playwright test --project=visual-setup
 *
 * 2026-07-27: rewritten to use BROWSER login instead of `request.post` — the
 * same fix tests/e2e/auth.setup.ts has carried since 2026-04-26. It was never
 * backported here because the visual project could not even load (a Prisma 7
 * `import.meta` error in smoke-cache-components.test.ts took the whole project
 * down at collection time), so nobody ever saw it fail.
 *
 * The old pattern was `request.post(...)` then `context.storageState()`.
 * `request` is a SEPARATE APIRequestContext, so the session cookie it received
 * never landed in the browser context and the saved state.json held no cookies.
 * Every test using that state then ran UNAUTHENTICATED, was redirected to
 * /login, and asserted against the login page instead of the route under test.
 *
 * 2026-09-21: vendor and admin states added so smoke-cache-components.test.ts
 * can stop signing in from inside its tests. `state.json` stays as the
 * facility alias — facility-pages, contract-detail and smoke-charles read it.
 */

setup("authenticate as facility user", async ({ page, context }) => {
  await browserSignIn(
    page,
    "demo-facility@tydei.com",
    "demo-facility-2024",
    /\/dashboard/,
  )
  await context.storageState({ path: "tests/visual/.auth/state.json" })
  await context.storageState({ path: "tests/visual/.auth/facility.json" })
})

setup("authenticate as vendor user", async ({ page, context }) => {
  await browserSignIn(
    page,
    "demo-vendor@tydei.com",
    "demo-vendor-2024",
    /\/vendor/,
  )
  await context.storageState({ path: "tests/visual/.auth/vendor.json" })
})

setup("authenticate as admin user", async ({ page, context }) => {
  await browserSignIn(
    page,
    "demo-admin@tydei.com",
    "demo-admin-2024",
    /\/admin/,
  )
  await context.storageState({ path: "tests/visual/.auth/admin.json" })
})
