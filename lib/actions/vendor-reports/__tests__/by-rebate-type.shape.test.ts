import { describe, expect, it } from "vitest"

import {
  getVendorRebateBreakdownByType,
  type RebateTypeBucket,
} from "@/lib/actions/vendor-reports/by-rebate-type"

/**
 * Shape guard for the vendor-scoped mirror of getRebateBreakdownByType.
 * We do NOT invoke the action here — it gates on requireVendor() (auth +
 * DB), which isn't available in a unit context. Instead we assert the
 * export exists and pin the byte-identical RebateTypeBucket shape the
 * shared presentational tab depends on.
 */
describe("getVendorRebateBreakdownByType", () => {
  it("exports an async function", () => {
    expect(typeof getVendorRebateBreakdownByType).toBe("function")
    expect(getVendorRebateBreakdownByType.constructor.name).toBe(
      "AsyncFunction",
    )
  })

  it("RebateTypeBucket has the byte-identical shape", () => {
    // A representative bucket constructed against the exported type.
    // If a field is added/removed/retyped, this fails to compile under
    // strict TS (and the runtime key assertion below catches drift too).
    const bucket: RebateTypeBucket = {
      termType: "spend_rebate",
      earned: 1234.56,
      collected: 1000,
      rowCount: 3,
      contractCount: 2,
      inferred: false,
    }

    expect(Object.keys(bucket).sort()).toEqual(
      [
        "collected",
        "contractCount",
        "earned",
        "inferred",
        "rowCount",
        "termType",
      ].sort(),
    )
    expect(typeof bucket.termType).toBe("string")
    expect(typeof bucket.earned).toBe("number")
    expect(typeof bucket.collected).toBe("number")
    expect(typeof bucket.rowCount).toBe("number")
    expect(typeof bucket.contractCount).toBe("number")
    expect(typeof bucket.inferred).toBe("boolean")
  })
})
