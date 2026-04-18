import { describe, it, expect } from "vitest"
import { sortCases } from "../sort-cases"

interface TestCase {
  id: string
  dateOfSurgery: Date
  caseNumber: string
  surgeonName: string | null
  totalSpend: number
  totalReimbursement: number
}

const cases: TestCase[] = [
  {
    id: "a",
    dateOfSurgery: new Date("2026-01-10T00:00:00Z"),
    caseNumber: "CASE-010",
    surgeonName: "Smith",
    totalSpend: 10_000,
    totalReimbursement: 20_000,
  },
  {
    id: "b",
    dateOfSurgery: new Date("2026-02-10T00:00:00Z"),
    caseNumber: "CASE-005",
    surgeonName: "Adams",
    totalSpend: 15_000,
    totalReimbursement: 25_000,
  },
  {
    id: "c",
    dateOfSurgery: new Date("2026-03-10T00:00:00Z"),
    caseNumber: "CASE-003",
    surgeonName: null,
    totalSpend: 5_000,
    totalReimbursement: 0,
  },
  {
    id: "d",
    dateOfSurgery: new Date("2026-01-10T00:00:00Z"),
    caseNumber: "CASE-008",
    surgeonName: "Zhang",
    totalSpend: 8_000,
    totalReimbursement: 12_000,
  },
]

describe("sortCases", () => {
  it("sorts by dateOfSurgery asc", () => {
    const r = sortCases(cases, "dateOfSurgery", "asc")
    expect(r.map((c) => c.id)).toEqual(["a", "d", "b", "c"])
  })

  it("sorts by dateOfSurgery desc", () => {
    const r = sortCases(cases, "dateOfSurgery", "desc")
    expect(r.map((c) => c.id)).toEqual(["c", "b", "a", "d"])
  })

  it("is stable: preserves input order on ties", () => {
    // a and d share same date; input order is a before d → stable keeps a,d
    const r = sortCases(cases, "dateOfSurgery", "asc")
    const ids = r.map((c) => c.id)
    const aIdx = ids.indexOf("a")
    const dIdx = ids.indexOf("d")
    expect(aIdx).toBeLessThan(dIdx)
  })

  it("is non-mutating", () => {
    const snapshot = cases.map((c) => c.id)
    sortCases(cases, "totalSpend", "desc")
    expect(cases.map((c) => c.id)).toEqual(snapshot)
  })

  it("sorts by caseNumber asc (lex)", () => {
    const r = sortCases(cases, "caseNumber", "asc")
    expect(r.map((c) => c.caseNumber)).toEqual([
      "CASE-003",
      "CASE-005",
      "CASE-008",
      "CASE-010",
    ])
  })

  it("surgeonName asc → nulls last", () => {
    const r = sortCases(cases, "surgeonName", "asc")
    expect(r.map((c) => c.id)).toEqual(["b", "a", "d", "c"])
  })

  it("surgeonName desc → nulls first", () => {
    const r = sortCases(cases, "surgeonName", "desc")
    expect(r.map((c) => c.id)).toEqual(["c", "d", "a", "b"])
  })

  it("sorts by totalSpend asc/desc", () => {
    expect(sortCases(cases, "totalSpend", "asc").map((c) => c.id)).toEqual([
      "c",
      "d",
      "a",
      "b",
    ])
    expect(sortCases(cases, "totalSpend", "desc").map((c) => c.id)).toEqual([
      "b",
      "a",
      "d",
      "c",
    ])
  })

  it("sorts by totalReimbursement desc", () => {
    const r = sortCases(cases, "totalReimbursement", "desc")
    expect(r.map((c) => c.id)).toEqual(["b", "a", "d", "c"])
  })

  it("sorts by margin (reimb - spend) desc", () => {
    // margins: a=10_000, b=10_000, c=-5_000, d=4_000
    const r = sortCases(cases, "margin", "desc")
    // a,b tie → stable input order a before b
    expect(r.map((c) => c.id)).toEqual(["a", "b", "d", "c"])
  })

  it("sorts by marginPercent — divide-by-zero → 0", () => {
    // percent: a=50, b=40, c=0 (reimb=0), d=~33.33
    const r = sortCases(cases, "marginPercent", "desc")
    expect(r.map((c) => c.id)).toEqual(["a", "b", "d", "c"])
  })

  it("marginPercent asc puts negative/zero margins first", () => {
    const r = sortCases(cases, "marginPercent", "asc")
    // c=0, d≈33.33, b=40, a=50
    expect(r.map((c) => c.id)).toEqual(["c", "d", "b", "a"])
  })

  it("returns a new array instance", () => {
    const r = sortCases(cases, "dateOfSurgery", "asc")
    expect(r).not.toBe(cases)
  })
})
