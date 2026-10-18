import { test, expect } from "@playwright/test"

test.describe("read-only facility user", () => {
  test.use({ storageState: "tests/e2e/.auth/facility-user.json" })

  test("is sent back from the new-contract page", async ({ page }) => {
    await page.goto("/dashboard/contracts/new")
    await expect(page).toHaveURL(/\/dashboard\/contracts$/)
  })

  test("cannot follow the New Contract link", async ({ page }) => {
    await page.goto("/dashboard/contracts")
    const link = page.getByRole("link", { name: "New Contract" })
    await expect(page.locator("fieldset[inert]").filter({ has: link })).toHaveCount(1)
    await link.click({ force: true })
    await expect(page).toHaveURL(/\/dashboard\/contracts$/)
  })

  test("is sent back from a contract's edit page", async ({ page }) => {
    await page.goto("/dashboard/contracts")
    const first = page.locator('table a[href^="/dashboard/contracts/"]').first()
    await expect(first).toBeVisible()
    const href = await first.getAttribute("href")
    await page.goto(`${href}/edit`)
    await expect(page).toHaveURL(new RegExp(`${href}$`))
  })

  test("cannot use a contract's Edit button", async ({ page }) => {
    await page.goto("/dashboard/contracts")
    await page.locator('table a[href^="/dashboard/contracts/"]').first().click()
    await expect(page).toHaveURL(/\/dashboard\/contracts\/[^/]+$/)
    const edit = page.getByRole("button", { name: "Edit Contract" })
    await expect(page.locator("fieldset[inert]").filter({ has: edit })).toHaveCount(1)
  })
})

test.describe("advanced facility user", () => {
  test.use({ storageState: "tests/e2e/.auth/facility-adv.json" })

  test("can open the new-contract page", async ({ page }) => {
    await page.goto("/dashboard/contracts/new")
    await expect(page).toHaveURL(/\/dashboard\/contracts\/new$/)
  })

  test("is sent away from the category alias settings page", async ({ page }) => {
    await page.goto("/dashboard/settings/categories")
    await expect(page).toHaveURL(/\/dashboard$/)
  })
})

test.describe("read-only vendor user", () => {
  test.use({ storageState: "tests/e2e/.auth/vendor-user.json" })

  test("is sent back from the new-contract page", async ({ page }) => {
    await page.goto("/vendor/contracts/new")
    await expect(page).toHaveURL(/\/vendor\/contracts$/)
  })

  test("cannot start a new proposal", async ({ page }) => {
    await page.goto("/vendor/prospective")
    const button = page.getByRole("button", { name: "New Proposal" }).first()
    await expect(button).toBeVisible()
    await expect(page.locator("fieldset[inert]").filter({ has: button }).first()).toBeAttached()
  })
})
