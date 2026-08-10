import { describe, it, expect } from "vitest"
import {
  getMedicareAscRate,
  getAllMedicareAscRates,
  effectiveReimbursementPerCase,
  DEFAULT_PERCENT_OF_MEDICARE,
} from "../medicare-asc-rates"

describe("medicare-asc-rates", () => {
  it("anchors: total knee CPT 27447 $9,450 / total hip CPT 27130 $9,641 (CY2025)", () => {
    expect(getMedicareAscRate("Total Knee Replacement")).toMatchObject({
      code: "CPT 27447",
      medicareRate: 9_450,
    })
    expect(getMedicareAscRate("Total Hip Replacement")).toMatchObject({
      code: "CPT 27130",
      medicareRate: 9_641,
    })
  })

  it("packaged add-on (navigation) carries $0 separate payment with a note", () => {
    const nav = getMedicareAscRate("Computer Assisted Nav")
    expect(nav?.medicareRate).toBe(0)
    expect(nav?.note).toBeTruthy()
  })

  it("lookup is case/whitespace-insensitive (uploaded names vary)", () => {
    expect(getMedicareAscRate("total knee replacement")?.medicareRate).toBe(9_450)
    expect(getMedicareAscRate("  Rotator Cuff Repair ")?.medicareRate).toBe(5_650)
    expect(getMedicareAscRate("Not A Real Group")).toBeUndefined()
  })

  it("effective reimbursement = rate × % of Medicare (whole percent), rounded", () => {
    expect(effectiveReimbursementPerCase(9_450, DEFAULT_PERCENT_OF_MEDICARE)).toBe(
      11_340,
    )
    expect(effectiveReimbursementPerCase(9_641, 100)).toBe(9_641)
    expect(effectiveReimbursementPerCase(9_641, 0)).toBe(0)
  })

  it("every listed rate is a non-negative finite number", () => {
    for (const r of getAllMedicareAscRates()) {
      expect(Number.isFinite(r.medicareRate)).toBe(true)
      expect(r.medicareRate).toBeGreaterThanOrEqual(0)
    }
  })
})
