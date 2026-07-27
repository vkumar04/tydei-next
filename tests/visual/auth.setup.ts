import { test as setup } from "@playwright/test"

/**
 * Authenticate once and save cookies for all visual tests.
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
 */
setup("authenticate", async ({ page, context }) => {
  await page.goto("/login")
  // Label-based lookup — the placeholder is "you@example.com", which does NOT
  // match /email/i. The associated <Label> is the stable selector.
  await page.getByLabel(/^email$/i).fill("demo-facility@tydei.com")
  await page.getByLabel(/^password$/i).fill("demo-facility-2024")
  await page.getByRole("button", { name: /sign in|log in/i }).click()
  await page.waitForURL(/\/dashboard/, { timeout: 15_000 })

  await context.storageState({ path: "tests/visual/.auth/state.json" })
})
