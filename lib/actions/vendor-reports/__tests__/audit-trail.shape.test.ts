import { describe, it, expect } from "vitest"

import { getVendorRebateCalculationAudit } from "../audit-trail"

describe("getVendorRebateCalculationAudit", () => {
  it("is exported as an async function", () => {
    expect(getVendorRebateCalculationAudit).toBeTypeOf("function")
    // "use server" actions are async — verify the constructor name so we
    // don't accidentally export a sync stub.
    expect(getVendorRebateCalculationAudit.constructor.name).toBe(
      "AsyncFunction",
    )
    expect(getVendorRebateCalculationAudit.length).toBe(1)
  })
})
