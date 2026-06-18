import { describe, it, expect } from "vitest"
import {
  buildCptRateSchedule,
  buildCptRateMap,
  rateAsOf,
  resolveCaseReimbursement,
} from "../cpt-rate-map"

// Anthem-style multi-year contract: one rate per CPT per contract year.
const multiYearContract = {
  cptRates: [
    { cptCode: "22552", rate: 11164, effectiveDate: "2023-06-01" },
    { cptCode: "22552", rate: 11490, effectiveDate: "2024-06-01" },
    { cptCode: "22552", rate: 11844, effectiveDate: "2025-06-01" },
  ],
}

// Legacy seeded contract: single undated rate per CPT.
const seededContract = {
  cptRates: [
    { cpt: "29827", rate: 4200, description: "Arthroscopy" },
    { cpt: "29827", rate: 4500 }, // duplicate, higher
  ],
}

describe("buildCptRateSchedule", () => {
  it("groups rates by CPT, sorted ascending by effective date", () => {
    const s = buildCptRateSchedule([multiYearContract])
    const buckets = s.get("22552")!
    expect(buckets.map((b) => b.rate)).toEqual([11164, 11490, 11844])
    expect(buckets[0]!.effectiveFrom).toBeInstanceOf(Date)
  })

  it("tolerates both {cpt} and {cptCode} and effectiveFrom alias", () => {
    const s = buildCptRateSchedule([
      { cptRates: [{ cpt: "10", rate: 5, effectiveFrom: "2024-01-01" }] },
    ])
    expect(s.get("10")![0]!.rate).toBe(5)
    expect(s.get("10")![0]!.effectiveFrom).toBeInstanceOf(Date)
  })
})

describe("rateAsOf — date-aware selection", () => {
  const buckets = buildCptRateSchedule([multiYearContract]).get("22552")!

  it("picks the Year-1 rate for a Year-1 case", () => {
    expect(rateAsOf(buckets, new Date("2024-03-01"))).toBe(11164)
  })
  it("picks the Year-2 rate for a Year-2 case", () => {
    expect(rateAsOf(buckets, new Date("2024-08-01"))).toBe(11490)
  })
  it("picks the Year-3 rate for a Year-3 case", () => {
    expect(rateAsOf(buckets, new Date("2025-09-01"))).toBe(11844)
  })
  it("falls back to the earliest rate for a case before all windows", () => {
    expect(rateAsOf(buckets, new Date("2022-01-01"))).toBe(11164)
  })
  it("uses the earliest (conservative) rate when the case date is unknown", () => {
    expect(rateAsOf(buckets, null)).toBe(11164)
  })

  it("keeps legacy highest-wins for undated rates regardless of date", () => {
    const undated = buildCptRateSchedule([seededContract]).get("29827")!
    expect(rateAsOf(undated, new Date("2024-01-01"))).toBe(4500)
    expect(rateAsOf(undated, null)).toBe(4500)
  })

  it("returns undefined for an unknown CPT", () => {
    expect(rateAsOf(undefined, new Date())).toBeUndefined()
  })
})

describe("buildCptRateMap — flat highest-wins (display)", () => {
  it("collapses multi-year rates to the highest across years", () => {
    const m = buildCptRateMap([multiYearContract])
    expect(m.get("22552")).toBe(11844)
  })
})

describe("resolveCaseReimbursement", () => {
  const schedule = buildCptRateSchedule([multiYearContract])

  it("short-circuits to the stored reimbursement when set", () => {
    const r = resolveCaseReimbursement(
      { storedReimbursement: 9999, primaryCptCode: "22552", procedureCptCodes: [] },
      schedule,
      new Date("2025-09-01"),
    )
    expect(r).toBe(9999)
  })

  it("uses the rate effective as of the case's surgery date", () => {
    const year1 = resolveCaseReimbursement(
      { storedReimbursement: 0, primaryCptCode: "22552", procedureCptCodes: [] },
      schedule,
      new Date("2023-12-15"),
    )
    expect(year1).toBe(11164)

    const year3 = resolveCaseReimbursement(
      { storedReimbursement: 0, primaryCptCode: "22552", procedureCptCodes: [] },
      schedule,
      new Date("2025-12-15"),
    )
    expect(year3).toBe(11844)
  })

  it("takes the best matching CPT across primary + procedure codes", () => {
    const s = buildCptRateSchedule([
      {
        cptRates: [
          { cptCode: "100", rate: 500, effectiveDate: "2023-06-01" },
          { cptCode: "200", rate: 800, effectiveDate: "2023-06-01" },
        ],
      },
    ])
    const r = resolveCaseReimbursement(
      { storedReimbursement: 0, primaryCptCode: "100", procedureCptCodes: ["200"] },
      s,
      new Date("2023-09-01"),
    )
    expect(r).toBe(800)
  })
})
