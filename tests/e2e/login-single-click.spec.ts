import { test, expect } from "@playwright/test"

/**
 * Real-browser cover for two reported login bugs (2026-07-26).
 *
 *  1. "I have to click Sign in twice to log in."
 *     The form did `router.push("/dashboard")` then `router.refresh()`.
 *     Per the Next docs, refresh() refreshes the CURRENT route and clears the
 *     Client Cache for the current route only — so it refreshed /login, the
 *     route being left, while racing the in-flight navigation. <Link> also
 *     prefetches routes into view, so the destination's RSC payload could
 *     already be cached from when the visitor was SIGNED OUT (i.e. the
 *     redirect-back-to-login result). Sign-in now does a full-page navigation.
 *
 *  2. "?callbackUrl is ignored."
 *     proxy.ts sets it when bouncing an unauthenticated visitor, but nothing
 *     read it, so you always landed on /dashboard and lost your place. That
 *     also broke the /accept-invitation round-trip.
 *
 * These run against the seeded demo accounts and need SHOW_DEMO_LOGINS unset
 * or set — they type credentials directly rather than using the demo buttons,
 * so they work either way.
 */

const FACILITY = { email: "demo-facility@tydei.com", password: "demo-facility-2024" }
const ADMIN = { email: "demo-admin@tydei.com", password: "demo-admin-2024" }

async function signIn(
  page: import("@playwright/test").Page,
  who: { email: string; password: string },
) {
  await page.getByLabel("Email").fill(who.email)
  await page.getByLabel("Password").fill(who.password)
  // Exactly ONE click. That is the whole point of the test.
  await page.getByRole("button", { name: "Sign in" }).click()
}

test.describe("login", () => {
  test("a single click signs a facility user in and lands on the dashboard", async ({
    page,
  }) => {
    await page.goto("/login")
    await signIn(page, FACILITY)

    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 })
    // Must not still be sitting on /login waiting for a second click.
    expect(page.url()).not.toContain("/login")
  })

  test("a single click signs an admin in and the server routes them to /admin", async ({
    page,
  }) => {
    await page.goto("/login")
    await signIn(page, ADMIN)

    // The client always targets /dashboard; the server 307s an admin onward.
    // One source of truth for role routing, one click for the user.
    await expect(page).toHaveURL(/\/admin\/dashboard/, { timeout: 20_000 })
  })

  test("honours ?callbackUrl instead of always going to /dashboard", async ({
    page,
  }) => {
    await page.goto("/login?callbackUrl=%2Fdashboard%2Fcontracts")
    await signIn(page, FACILITY)

    await expect(page).toHaveURL(/\/dashboard\/contracts/, { timeout: 20_000 })
  })

  test("ignores an off-site callbackUrl (open-redirect guard)", async ({ page }) => {
    await page.goto("/login?callbackUrl=https%3A%2F%2Fevil.example.com")
    await signIn(page, FACILITY)

    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 })
    expect(page.url()).toContain("localhost:3000")
  })

  test("a protected page bounces to login and returns you there after sign-in", async ({
    page,
  }) => {
    // This is the flow the invitation email depends on.
    await page.goto("/dashboard/contracts")
    await expect(page).toHaveURL(/\/login\?callbackUrl=/, { timeout: 20_000 })

    await signIn(page, FACILITY)
    await expect(page).toHaveURL(/\/dashboard\/contracts/, { timeout: 20_000 })
  })
})

test.describe("admin console access", () => {
  test("a facility Super is kept out of /admin/users", async ({ page }) => {
    // demo-facility@tydei.com is accessTier `super` but UserRole `facility`.
    // The operator console is cross-tenant and must stay UserRole-gated —
    // this redirect is correct behaviour, pinned so it can't silently relax.
    await page.goto("/login")
    await signIn(page, FACILITY)
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 })

    await page.goto("/admin/users")
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 })
    expect(page.url()).not.toContain("/admin")
  })

  test("a platform admin reaches /admin/users", async ({ page }) => {
    await page.goto("/login")
    await signIn(page, ADMIN)
    await expect(page).toHaveURL(/\/admin\/dashboard/, { timeout: 20_000 })

    await page.goto("/admin/users")
    await expect(page).toHaveURL(/\/admin\/users/, { timeout: 20_000 })
  })
})
