import { describe, it, expect } from "vitest"
import { datesOverlap, facilitiesOverlap } from "../date-range"

describe("datesOverlap", () => {
  const a = (s: string) => new Date(s)

  it("returns true for identical ranges", () => {
    expect(
      datesOverlap(a("2026-01-01"), a("2026-12-31"), a("2026-01-01"), a("2026-12-31")),
    ).toBe(true)
  })

  it("returns true when ranges touch on a shared boundary (inclusive)", () => {
    // A ends on the same day B starts
    expect(
      datesOverlap(a("2026-01-01"), a("2026-06-30"), a("2026-06-30"), a("2026-12-31")),
    ).toBe(true)
  })

  it("returns true when one range is fully contained in the other", () => {
    expect(
      datesOverlap(a("2026-01-01"), a("2026-12-31"), a("2026-03-01"), a("2026-06-30")),
    ).toBe(true)
    // Symmetric
    expect(
      datesOverlap(a("2026-03-01"), a("2026-06-30"), a("2026-01-01"), a("2026-12-31")),
    ).toBe(true)
  })

  it("returns false when ranges are fully disjoint", () => {
    expect(
      datesOverlap(a("2025-01-01"), a("2025-12-31"), a("2026-01-01"), a("2026-12-31")),
    ).toBe(false)
    // Symmetric
    expect(
      datesOverlap(a("2026-01-01"), a("2026-12-31"), a("2025-01-01"), a("2025-12-31")),
    ).toBe(false)
  })

  it("treats a null expiration on A as indefinite (+Infinity)", () => {
    // A starts in 2026 and never ends — overlaps any later range.
    expect(
      datesOverlap(a("2026-01-01"), null, a("2030-01-01"), a("2030-06-30")),
    ).toBe(true)
  })

  it("treats a null expiration on B as indefinite (+Infinity)", () => {
    expect(
      datesOverlap(a("2030-01-01"), a("2030-06-30"), a("2026-01-01"), null),
    ).toBe(true)
  })

  it("treats null on both sides as overlap (both indefinite)", () => {
    expect(datesOverlap(a("2026-01-01"), null, a("2027-01-01"), null)).toBe(true)
  })

  it("null-expiration A does NOT overlap a range entirely before A starts", () => {
    // A = [2026-01-01, +∞), B = [2025-01-01, 2025-12-31]
    expect(
      datesOverlap(a("2026-01-01"), null, a("2025-01-01"), a("2025-12-31")),
    ).toBe(false)
  })
})

describe("facilitiesOverlap", () => {
  it("returns false for two empty arrays", () => {
    expect(facilitiesOverlap([], [])).toBe(false)
  })

  it("returns false when one side is empty", () => {
    expect(facilitiesOverlap(["fac-1"], [])).toBe(false)
    expect(facilitiesOverlap([], ["fac-1"])).toBe(false)
  })

  it("returns true for a single shared id", () => {
    expect(facilitiesOverlap(["fac-1"], ["fac-1"])).toBe(true)
  })

  it("returns true when multiple ids are shared", () => {
    expect(
      facilitiesOverlap(["fac-1", "fac-2", "fac-3"], ["fac-2", "fac-3", "fac-4"]),
    ).toBe(true)
  })

  it("returns false when there is no shared id", () => {
    expect(facilitiesOverlap(["fac-1", "fac-2"], ["fac-3", "fac-4"])).toBe(false)
  })
})
