import { test, expect } from "@playwright/test"

/**
 * No page may scroll horizontally.
 *
 * Why this exists (2026-07-27 responsive audit): 26 of 27 authenticated
 * routes overflowed horizontally, and it was two shared shell bugs rather
 * than 26 page bugs. Both had the same shape — a flex/grid child keeping the
 * default `min-width: auto`, so it could not shrink below its content and
 * sat at full width beside the 256px sidebar:
 *
 *   1. SidebarInset (components/ui/sidebar.tsx) was missing `min-w-0`
 *      -> +256px at 768 and 1280.
 *   2. The portal header's search column used `1fr`, whose automatic
 *      minimum is min-content, and the wrapper lacked `min-w-0`
 *      -> +121px, at 768 only.
 *
 * Measured, not guessed: /dashboard at 768 went +137 broken -> +121 with
 * only fix 1 -> +0 with both.
 *
 * The guard matters most for fix 1, because `components/ui/sidebar.tsx` is a
 * VENDORED shadcn component. Re-running `shadcn add sidebar` overwrites it
 * and the overflow returns silently on every route at once.
 *
 * 768 is the important width: below `md` the sidebar is off-canvas so the
 * layout was always fine, and phones never broke. Tablet portrait is exactly
 * where the sidebar becomes inline and the space runs out.
 */

const BREAKPOINTS = [
  { name: "375 phone", width: 375 },
  { name: "768 tablet portrait", width: 768 },
  { name: "1280 laptop", width: 1280 },
]

/** One data-dense route per portal — those overflow first. */
const ROUTES = [
  { role: "facility", path: "/dashboard" },
  { role: "facility", path: "/dashboard/contracts" },
  { role: "vendor", path: "/vendor/dashboard" },
  { role: "admin", path: "/admin/users" },
] as const

for (const { role, path } of ROUTES) {
  test.describe(`${path} does not scroll horizontally`, () => {
    test.use({ storageState: `tests/e2e/.auth/${role}.json` })

    for (const bp of BREAKPOINTS) {
      test(`at ${bp.name}`, async ({ page }) => {
        await page.setViewportSize({ width: bp.width, height: 900 })
        await page.goto(path, { waitUntil: "domcontentloaded" })
        await expect(page).toHaveURL(new RegExp(path.replace(/\//g, "\\/")), {
          timeout: 20_000,
        })
        // Let client-side data land — tables are the usual culprits.
        await page.waitForTimeout(1200)

        const overflow = await page.evaluate(() => {
          const de = document.documentElement
          return de.scrollWidth - de.clientWidth
        })

        expect(
          overflow,
          `${path} @${bp.width}px overflows by ${overflow}px — check that ` +
            `SidebarInset still has min-w-0 and the header column is ` +
            `minmax(0,1fr)`,
        ).toBeLessThanOrEqual(1)
      })
    }
  })
}
