import { test, expect } from "@playwright/test"
import { browserSignIn } from "../support/sign-in"

const POLLED_ROUTES = ["/api/alerts/unread-count", "/api/notifications"]
const POLL_INTERVAL_MS = 30_000

test.describe("sign-out stops the header polls", () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test("no polled route is hit after the session is cleared", async ({ page }) => {
    test.setTimeout(120_000)
    await browserSignIn(page, "demo-facility@tydei.com", "demo-facility-2024", /\/dashboard/)
    await expect(page.getByRole("link", { name: /alerts$/ })).toBeVisible({ timeout: 20_000 })

    await page.route(
      (url) => url.pathname === "/login",
      async (route) => {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS + 15_000))
        await route.continue()
      },
    )

    const unauthorized: string[] = []
    page.on("response", (res) => {
      const url = new URL(res.url())
      if (POLLED_ROUTES.includes(url.pathname) && res.status() === 401) {
        unauthorized.push(url.pathname)
      }
    })

    await page.getByRole("button", { name: /demo-facility@tydei\.com/ }).click()
    await page.getByRole("menuitem", { name: "Sign out" }).click()
    await page.waitForTimeout(POLL_INTERVAL_MS + 5_000)

    expect(unauthorized).toEqual([])
  })
})
