import { test as setup, type Page } from "@playwright/test"

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
 */

async function browserLogin(
  page: Page,
  email: string,
  password: string,
  expectedUrlPattern: RegExp,
): Promise<void> {
  await page.goto("/login")
  await page.getByPlaceholder(/email/i).fill(email)
  await page.getByPlaceholder(/password/i).fill(password)
  await page.getByRole("button", { name: /sign in|log in/i }).click()
  await page.waitForURL(expectedUrlPattern, { timeout: 15_000 })
}

setup("authenticate as facility user", async ({ page, context }) => {
  await browserLogin(
    page,
    "demo-facility@tydei.com",
    "demo-facility-2024",
    /\/dashboard/,
  )
  await context.storageState({ path: "tests/e2e/.auth/facility.json" })
})

setup("authenticate as vendor user", async ({ page, context }) => {
  await browserLogin(
    page,
    "demo-vendor@tydei.com",
    "demo-vendor-2024",
    /\/vendor/,
  )
  await context.storageState({ path: "tests/e2e/.auth/vendor.json" })
})

setup("authenticate as admin user", async ({ page, context }) => {
  await browserLogin(
    page,
    "demo-admin@tydei.com",
    "demo-admin-2024",
    /\/admin/,
  )
  await context.storageState({ path: "tests/e2e/.auth/admin.json" })
})
