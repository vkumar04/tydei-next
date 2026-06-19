import { describe, it, expect } from "vitest"
import { vendorCogScopedByDivisions } from "../vendor-cog-scope"

const VENDOR = "vendor_abc"

describe("vendorCogScopedByDivisions", () => {
  it("undefined divisionIds → no division clause (vendor-wide)", () => {
    const where = vendorCogScopedByDivisions(VENDOR, undefined)
    expect(where).toEqual({ vendorId: VENDOR })
    expect("vendorDivisionId" in where).toBe(false)
  })

  it("empty divisionIds → matches NOTHING (in: [])", () => {
    const where = vendorCogScopedByDivisions(VENDOR, [])
    expect(where).toEqual({ vendorId: VENDOR, vendorDivisionId: { in: [] } })
  })

  it("[ids] → vendorDivisionId: { in: ids }", () => {
    const where = vendorCogScopedByDivisions(VENDOR, ["d1", "d2"])
    expect(where).toEqual({
      vendorId: VENDOR,
      vendorDivisionId: { in: ["d1", "d2"] },
    })
  })

  it("vendorId is ALWAYS present, regardless of divisionIds", () => {
    expect(vendorCogScopedByDivisions(VENDOR, undefined).vendorId).toBe(VENDOR)
    expect(vendorCogScopedByDivisions(VENDOR, []).vendorId).toBe(VENDOR)
    expect(vendorCogScopedByDivisions(VENDOR, ["d1"]).vendorId).toBe(VENDOR)
  })
})
