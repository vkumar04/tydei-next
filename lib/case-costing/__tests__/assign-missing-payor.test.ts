/**
 * computeMissingPayorAssignment — import-time demo payor assignment.
 *
 * 2026-06-15: the demo case export has no payor column, so payor-mix
 * surfaces showed "No payor data" and a manual backfill reverted on
 * re-import. These tests pin the import-time fallback: no-payor uploads get
 * a realistic mix, uploads carrying payor are left untouched.
 */
import { describe, it, expect } from "vitest"
import { computeMissingPayorAssignment } from "@/lib/case-costing/assign-missing-payor"
import { classifyPayorClass } from "@/lib/case-costing/payor-mix"

describe("computeMissingPayorAssignment", () => {
  it("returns null when the upload already carries payor data", () => {
    expect(
      computeMissingPayorAssignment([
        { caseNumber: "A", payorClass: "Medicare" },
        { caseNumber: "B", payorClass: null },
      ]),
    ).toBeNull()
  })

  it("returns null for an empty upload", () => {
    expect(computeMissingPayorAssignment([])).toBeNull()
  })

  it("assigns a payor to every case when none has one", () => {
    const cases = Array.from({ length: 50 }, (_, i) => ({
      caseNumber: `C${i}`,
      payorClass: i % 2 === 0 ? null : "  ", // null + blank both count as missing
    }))
    const map = computeMissingPayorAssignment(cases)
    expect(map).not.toBeNull()
    expect(map!.size).toBe(50)
    // every assigned value classifies to a real bucket (not null)
    for (const v of map!.values()) {
      expect(classifyPayorClass(v)).not.toBeNull()
    }
  })

  it("is deterministic per caseNumber (stable across re-imports)", () => {
    const cases = [
      { caseNumber: "21501", payorClass: null },
      { caseNumber: "21502", payorClass: null },
    ]
    const a = computeMissingPayorAssignment(cases)!
    const b = computeMissingPayorAssignment(cases)!
    expect(a.get("21501")).toBe(b.get("21501"))
    expect(a.get("21502")).toBe(b.get("21502"))
  })

  it("produces a spread of payor types across a realistic case set", () => {
    const cases = Array.from({ length: 500 }, (_, i) => ({
      caseNumber: `case-${i}`,
      payorClass: null,
    }))
    const map = computeMissingPayorAssignment(cases)!
    const buckets = new Set(
      [...map.values()].map((v) => classifyPayorClass(v)),
    )
    // expect commercial + medicare + medicaid at least
    expect(buckets.has("commercial")).toBe(true)
    expect(buckets.has("medicare")).toBe(true)
    expect(buckets.has("medicaid")).toBe(true)
  })
})
