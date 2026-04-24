import { test, expect } from "@playwright/test"

/**
 * E2E: Vendor-role pages. Lightweight smoke — the vendor surfaces
 * don't have the same bug density as facility pages but regressions
 * here (bad session, wrong query scope) are equally bad.
 */
test.use({ storageState: "tests/e2e/.auth/vendor.json" })

test("vendor dashboard renders without error", async ({ page }) => {
  const resp = await page.goto("/vendor")
  expect(resp?.status()).toBeLessThan(500)
})

test("vendor contracts page renders", async ({ page }) => {
  const resp = await page.goto("/vendor/contracts")
  expect(resp?.status()).toBeLessThan(500)
})

test("vendor pending submissions page renders", async ({ page }) => {
  const resp = await page.goto("/vendor/contracts/pending")
  expect(resp?.status()).toBeLessThan(500)
})

test("vendor invoices page renders", async ({ page }) => {
  const resp = await page.goto("/vendor/invoices")
  expect(resp?.status()).toBeLessThan(500)
})
