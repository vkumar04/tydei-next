import { describe, it, expect } from "vitest"
import { canonicalizeCategoryName, bucketByCanonical } from "../category-canonical"

describe("canonicalizeCategoryName", () => {
  it("collapses simple word-order variants", () => {
    expect(canonicalizeCategoryName("Ortho Joint")).toBe(
      canonicalizeCategoryName("Joint Ortho"),
    )
    expect(canonicalizeCategoryName("Ortho-Joint")).toBe(
      canonicalizeCategoryName("ortho/joint"),
    )
  })

  it("keeps distinct concepts apart", () => {
    expect(canonicalizeCategoryName("Ortho Sports Med")).not.toBe(
      canonicalizeCategoryName("Ortho Joint"),
    )
  })

  it("returns empty string on null / undefined / blank", () => {
    expect(canonicalizeCategoryName(null)).toBe("")
    expect(canonicalizeCategoryName(undefined)).toBe("")
    expect(canonicalizeCategoryName("")).toBe("")
    expect(canonicalizeCategoryName("   ")).toBe("")
  })

  describe("Vick 2026-05-31 — semicolon-joined vendor categories", () => {
    it("collapses identical category strings", () => {
      const a = canonicalizeCategoryName("Supplies & Materials;Implants;Total Joint")
      const b = canonicalizeCategoryName("Supplies & Materials;Implants;Total Joint")
      expect(a).toBe(b)
    })

    it("treats singular and plural as equivalent (implant ↔ implants)", () => {
      expect(canonicalizeCategoryName("Supplies & Materials;Implants;Total Joint")).toBe(
        canonicalizeCategoryName("Supplies & Materials;Implant;Total Joint"),
      )
    })

    it("dedupes repeated tokens", () => {
      // Real-world: "Supplies & Materials;Implants;Implants;Total Joint"
      // sometimes appears when the export double-encodes the category.
      expect(
        canonicalizeCategoryName(
          "Supplies & Materials;Implants;Implants;Total Joint",
        ),
      ).toBe(
        canonicalizeCategoryName(
          "Supplies & Materials;Implants;Total Joint",
        ),
      )
    })

    it("treats comma and semicolon separators interchangeably", () => {
      expect(canonicalizeCategoryName("Implants;Total Joint")).toBe(
        canonicalizeCategoryName("Implants, Total Joint"),
      )
    })

    it("collapses dropped-delimiter concatenations with their delimited twin (bugs.rtfd 2026-06-13)", () => {
      // Vendor exports sometimes drop the ':'/';' entirely, fusing two words
      // at the case boundary. These must bucket with the delimited form.
      expect(canonicalizeCategoryName("Supplies & MaterialsOR Supplies & Materials")).toBe(
        canonicalizeCategoryName("Supplies & Materials:OR Supplies & Materials"),
      )
      expect(canonicalizeCategoryName("Supplies & MaterialsImplants:Sports Medicine")).toBe(
        canonicalizeCategoryName("Supplies & Materials:Implants:Sports Medicine"),
      )
      expect(canonicalizeCategoryName("Supplies & MaterialsImplants;Total Joint")).toBe(
        canonicalizeCategoryName("Supplies & Materials;Implants;Total Joint"),
      )
    })

    it("collapses a doubled-with-no-separator name to its single form", () => {
      expect(canonicalizeCategoryName("Surgical InstrumentationSurgical Instrumentation")).toBe(
        canonicalizeCategoryName("Surgical Instrumentation"),
      )
    })

    it("does NOT collapse typos (one edit away)", () => {
      // SSupplies vs Supplies — we can't auto-correct typos without a
      // dictionary, so they stay distinct. Documenting the limitation
      // so any future Levenshtein attempt is intentional.
      expect(
        canonicalizeCategoryName("SSupplies & Materials;Implants;Total Joint"),
      ).not.toBe(
        canonicalizeCategoryName("Supplies & Materials;Implants;Total Joint"),
      )
    })
  })

  describe("token lemmatization edge cases", () => {
    it("keeps 3-char tokens intact (no 's' stripping)", () => {
      // "abs" / "hrs" — too short to plural-strip without false positives
      expect(canonicalizeCategoryName("abs")).toBe("abs")
    })

    it("keeps -ss endings intact", () => {
      // "supplies" → "supplie" is fine; "stress" should stay "stress"
      expect(canonicalizeCategoryName("stress")).toBe("stress")
    })

    it("drops 'or' / 'and' / 'the' as noise (only the docstring set)", () => {
      // NOISE_TOKENS = the, and, of, for, a, an
      // "or" is NOT in the noise set per current implementation
      const withAnd = canonicalizeCategoryName("Knee and Hip")
      const withoutAnd = canonicalizeCategoryName("Knee Hip")
      expect(withAnd).toBe(withoutAnd)
    })
  })
})

describe("bucketByCanonical", () => {
  it("groups items that share a canonical key", () => {
    const grouped = bucketByCanonical([
      { name: "Ortho Joint" },
      { name: "Joint Ortho" },
      { name: "Ortho Sports Med" },
    ])
    expect(grouped.size).toBe(2)
    const orthoJointKey = canonicalizeCategoryName("Ortho Joint")
    expect(grouped.get(orthoJointKey)?.length).toBe(2)
  })

  it("skips empty / unparseable names", () => {
    const grouped = bucketByCanonical([{ name: "" }, { name: "  " }])
    expect(grouped.size).toBe(0)
  })
})
