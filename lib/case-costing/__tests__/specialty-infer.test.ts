import { describe, it, expect } from "vitest"
import {
  inferSpecialty,
  inferDominantSpecialty,
} from "../specialty-infer"

describe("inferSpecialty", () => {
  it.each([
    ["27447", "Orthopedics"],
    ["29881", "Orthopedics"],
    ["22551", "Spine"],
    ["63030", "Spine"],
    ["33208", "Cardiac"],
    ["43239", "General"],
    ["44970", "General"],
  ])("CPT %s → %s", (cpt, expected) => {
    expect(inferSpecialty(cpt)).toBe(expected)
  })

  it("handles null / undefined / empty / short input", () => {
    expect(inferSpecialty(null)).toBe("Unknown")
    expect(inferSpecialty(undefined)).toBe("Unknown")
    expect(inferSpecialty("")).toBe("Unknown")
    expect(inferSpecialty("1")).toBe("Unknown")
  })

  it("unknown prefix → Unknown", () => {
    expect(inferSpecialty("99999")).toBe("Unknown")
    expect(inferSpecialty("00123")).toBe("Unknown")
  })

  it("trims whitespace", () => {
    expect(inferSpecialty("  27447  ")).toBe("Orthopedics")
  })
})

describe("inferDominantSpecialty", () => {
  it("empty array → Unknown", () => {
    expect(inferDominantSpecialty([])).toBe("Unknown")
  })

  it("picks the specialty with most occurrences", () => {
    expect(
      inferDominantSpecialty(["27447", "27130", "22551"]),
    ).toBe("Orthopedics")
  })

  it("prefers any-known over all-Unknown", () => {
    expect(
      inferDominantSpecialty(["99999", "99998", "27447"]),
    ).toBe("Orthopedics")
  })

  it("returns Unknown when every code is unknown", () => {
    expect(inferDominantSpecialty(["99999", "99998"])).toBe("Unknown")
  })

  it("tie-breaks on count ordering", () => {
    // 1 Ortho, 1 Spine — both counts are 1, candidates sorted by count then
    // insertion order. Implementation returns first in sorted list.
    const result = inferDominantSpecialty(["27447", "22551"])
    expect(["Orthopedics", "Spine"]).toContain(result)
  })
})
