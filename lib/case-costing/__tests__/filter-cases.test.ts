import { describe, it, expect } from "vitest"
import { filterCases, type CaseForFilter } from "../filter-cases"

function makeCase(overrides: Partial<CaseForFilter> = {}): CaseForFilter {
  return {
    id: "c1",
    caseNumber: "CASE-001",
    surgeonName: "Dr. Smith",
    primaryCptCode: "27447",
    dateOfSurgery: new Date("2026-03-15T12:00:00Z"),
    patientType: "inpatient",
    payorType: "commercial",
    totalSpend: 10_000,
    totalReimbursement: 18_000,
    facilityId: "fac-1",
    ...overrides,
  }
}

const base: CaseForFilter[] = [
  makeCase({
    id: "a",
    caseNumber: "CASE-001",
    surgeonName: "Dr. Smith",
    primaryCptCode: "27447",
    dateOfSurgery: new Date("2026-01-10T12:00:00Z"),
    patientType: "inpatient",
    payorType: "commercial",
    facilityId: "fac-1",
  }),
  makeCase({
    id: "b",
    caseNumber: "CASE-002",
    surgeonName: "Dr. Jones",
    primaryCptCode: "29881",
    dateOfSurgery: new Date("2026-02-15T12:00:00Z"),
    patientType: "outpatient",
    payorType: "medicare",
    facilityId: "fac-1",
  }),
  makeCase({
    id: "c",
    caseNumber: "CASE-003",
    surgeonName: null,
    primaryCptCode: null,
    dateOfSurgery: new Date("2026-03-20T12:00:00Z"),
    patientType: null,
    payorType: null,
    facilityId: "fac-2",
  }),
  makeCase({
    id: "d",
    caseNumber: "CASE-004",
    surgeonName: "Dr. Smith",
    primaryCptCode: "27130",
    dateOfSurgery: new Date("2026-04-01T12:00:00Z"),
    patientType: "inpatient",
    payorType: "medicaid",
    facilityId: "fac-3",
  }),
]

describe("filterCases", () => {
  it("returns all cases when filters are empty", () => {
    expect(filterCases(base, {})).toHaveLength(4)
  })

  it("date range inclusive on both ends", () => {
    const r = filterCases(base, {
      dateFrom: new Date("2026-02-15T12:00:00Z"),
      dateTo: new Date("2026-03-20T12:00:00Z"),
    })
    expect(r.map((c) => c.id).sort()).toEqual(["b", "c"])
  })

  it("dateFrom-only excludes earlier cases", () => {
    const r = filterCases(base, {
      dateFrom: new Date("2026-03-01T00:00:00Z"),
    })
    expect(r.map((c) => c.id).sort()).toEqual(["c", "d"])
  })

  it("surgeons filter uses OR within field", () => {
    const r = filterCases(base, { surgeons: ["Dr. Smith", "Dr. Jones"] })
    expect(r.map((c) => c.id).sort()).toEqual(["a", "b", "d"])
  })

  it("surgeon filter excludes null surgeonName", () => {
    const r = filterCases(base, { surgeons: ["Dr. Smith"] })
    expect(r.map((c) => c.id).sort()).toEqual(["a", "d"])
  })

  it("cptCodes filter", () => {
    const r = filterCases(base, { cptCodes: ["27447"] })
    expect(r.map((c) => c.id)).toEqual(["a"])
  })

  it("patientTypes filter", () => {
    const r = filterCases(base, { patientTypes: ["outpatient"] })
    expect(r.map((c) => c.id)).toEqual(["b"])
  })

  it("payorTypes filter", () => {
    const r = filterCases(base, { payorTypes: ["commercial", "medicare"] })
    expect(r.map((c) => c.id).sort()).toEqual(["a", "b"])
  })

  it("facilityIds filter", () => {
    const r = filterCases(base, { facilityIds: ["fac-1"] })
    expect(r.map((c) => c.id).sort()).toEqual(["a", "b"])
  })

  it("search is case-insensitive substring across caseNumber/surgeon/CPT", () => {
    expect(filterCases(base, { search: "SMITH" }).map((c) => c.id).sort()).toEqual(
      ["a", "d"],
    )
    expect(filterCases(base, { search: "29881" }).map((c) => c.id)).toEqual(["b"])
    expect(filterCases(base, { search: "case-003" }).map((c) => c.id)).toEqual([
      "c",
    ])
  })

  it("search trims whitespace", () => {
    expect(
      filterCases(base, { search: "   smith   " }).map((c) => c.id).sort(),
    ).toEqual(["a", "d"])
  })

  it("empty search string acts as no filter", () => {
    expect(filterCases(base, { search: "   " })).toHaveLength(4)
    expect(filterCases(base, { search: "" })).toHaveLength(4)
  })

  it("empty arrays act as no filter", () => {
    expect(
      filterCases(base, {
        surgeons: [],
        cptCodes: [],
        patientTypes: [],
        payorTypes: [],
        facilityIds: [],
      }),
    ).toHaveLength(4)
  })

  it("composes AND across multiple fields", () => {
    const r = filterCases(base, {
      surgeons: ["Dr. Smith"],
      patientTypes: ["inpatient"],
      facilityIds: ["fac-1"],
    })
    expect(r.map((c) => c.id)).toEqual(["a"])
  })

  it("does not mutate the input array", () => {
    const copy = [...base]
    filterCases(base, { surgeons: ["Dr. Smith"] })
    expect(base).toEqual(copy)
  })
})
