import { test, expect } from "@playwright/test"

/**
 * "Clicking Users still redirects me to the dashboard."
 *
 * Earlier cover used page.goto("/admin/users") — a full navigation. A user
 * CLICKS the sidebar link, which is a client-side <Link> navigation through
 * the Router Cache, and <Link> prefetches routes as they scroll into view.
 * Different code path, so it gets its own test.
 *
 * These reuse the storageState written by auth.setup.ts rather than signing in
 * per test. That is not just tidiness: better-auth caps /sign-in/email at
 * 10/60s per IP, and a suite that signs in on every test trips it, after which
 * every sign-in 429s and the tests fail for a reason that has nothing to do
 * with what they are testing. (Observed exactly that while writing this file.)
 */

test.describe("admin sidebar navigation", () => {
  test.use({ storageState: "tests/e2e/.auth/admin.json" })

  test("platform admin can CLICK through to Users and stay there", async ({
    page,
  }) => {
    await page.goto("/admin/dashboard")
    await expect(page).toHaveURL(/\/admin\/dashboard/, { timeout: 20_000 })

    await page.getByRole("link", { name: "Users" }).first().click()

    await expect(page).toHaveURL(/\/admin\/users/, { timeout: 20_000 })
    // Wait past the late-redirect window. The original bug bounced ~3-4s after
    // landing, so a short wait passed by luck; 6s covers it with margin.
    await page.waitForTimeout(6000)
    expect(page.url(), "bounced away from /admin/users after landing").toContain(
      "/admin/users",
    )
  })

  test("the Users page renders its content, not a redirect shell", async ({
    page,
  }) => {
    await page.goto("/admin/dashboard")
    await page.getByRole("link", { name: "Users" }).first().click()
    await expect(page).toHaveURL(/\/admin\/users/, { timeout: 20_000 })
    await expect(page.getByRole("button", { name: /add user/i })).toBeVisible({
      timeout: 20_000,
    })
  })

  test("reloading /admin/users keeps you there", async ({ page }) => {
    await page.goto("/admin/users")
    await expect(page).toHaveURL(/\/admin\/users/, { timeout: 20_000 })
    await page.reload()
    await expect(page).toHaveURL(/\/admin\/users/, { timeout: 20_000 })
  })
})

test.describe("facility Super is not a platform admin", () => {
  test.use({ storageState: "tests/e2e/.auth/facility.json" })

  test("is redirected out of /admin/users (correct, deliberately pinned)", async ({
    page,
  }) => {
    // demo-facility@tydei.com is accessTier `super` but UserRole `facility`.
    // The operator console is cross-tenant and must stay UserRole-gated.
    await page.goto("/admin/users")
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 })
    expect(page.url()).not.toContain("/admin")
  })
})
