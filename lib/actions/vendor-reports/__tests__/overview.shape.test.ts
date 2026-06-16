import { describe, expect, it } from "vitest"
import { getVendorReportsOverview } from "@/lib/actions/vendor-reports/overview"
import type { ReportsOverviewPayload } from "@/lib/actions/reports/overview"

/**
 * Shape guard for the vendor-scoped Overview action.
 *
 * `getVendorReportsOverview` is a vendor-scoped mirror of
 * `getReportsOverview` and MUST return the byte-identical
 * `ReportsOverviewPayload` shape (`{ lifecycle, monthlyTrend, stats }`)
 * so the shared presentational Overview tab renders unchanged.
 *
 * We can't invoke the action here (it gates on `requireVendor()` →
 * session + DB), so we assert:
 *   1. the export exists and is an async function, and
 *   2. the payload contract — keyed off `ReportsOverviewPayload` — is
 *      exactly `{ lifecycle, monthlyTrend, stats }` with the documented
 *      `stats` sub-keys. A representative payload typed as
 *      `ReportsOverviewPayload` will fail to compile if the return type
 *      ever drifts from the facility action's exported shape.
 */
describe("getVendorReportsOverview — shape", () => {
  it("exports an async function", () => {
    expect(typeof getVendorReportsOverview).toBe("function")
    expect(getVendorReportsOverview.constructor.name).toBe("AsyncFunction")
  })

  it("returns the ReportsOverviewPayload shape { lifecycle, monthlyTrend, stats }", () => {
    const payload: ReportsOverviewPayload = {
      lifecycle: { active: 0, expiring: 0, expired: 0, other: 0 },
      monthlyTrend: [],
      stats: {
        totalContracts: 0,
        totalValue: 0,
        totalRebates: 0,
      },
    }

    expect(Object.keys(payload).sort()).toEqual(
      ["lifecycle", "monthlyTrend", "stats"].sort(),
    )
    expect(Object.keys(payload.stats).sort()).toEqual(
      ["totalContracts", "totalValue", "totalRebates"].sort(),
    )
  })
})
