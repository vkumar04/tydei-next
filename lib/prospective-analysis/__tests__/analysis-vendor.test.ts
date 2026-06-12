import { describe, expect, it } from "vitest"
import {
  matchVendorOptionByName,
  normalizeVendorNameLoose,
  resolveAnalysisVendorId,
  vendorNamesLooselyMatch,
} from "../analysis-vendor"

describe("resolveAnalysisVendorId — manual selection wins (R2)", () => {
  it("returns the manual selection when both are present (the bug: PDF-detected J&J must NOT beat selected Arthrex)", () => {
    expect(resolveAnalysisVendorId("arthrex-id", "jnj-id")).toBe("arthrex-id")
  })

  it("falls back to the PDF-detected vendor when nothing is selected", () => {
    expect(resolveAnalysisVendorId(null, "jnj-id")).toBe("jnj-id")
  })

  it("returns the selection when there is no detection", () => {
    expect(resolveAnalysisVendorId("arthrex-id", null)).toBe("arthrex-id")
  })

  it("returns null when neither is present", () => {
    expect(resolveAnalysisVendorId(null, null)).toBeNull()
  })
})

describe("normalizeVendorNameLoose", () => {
  it("lowercases and trims", () => {
    expect(normalizeVendorNameLoose("  ARTHREX ")).toBe("arthrex")
  })

  it("strips corporate suffixes with comma/period drift", () => {
    expect(normalizeVendorNameLoose("Arthrex, Inc.")).toBe("arthrex")
    expect(normalizeVendorNameLoose("Arthrex Inc")).toBe("arthrex")
    expect(normalizeVendorNameLoose("Stryker Corporation")).toBe("stryker")
    expect(normalizeVendorNameLoose("Medtronic LLC")).toBe("medtronic")
  })

  it("does not strip words that merely contain a suffix", () => {
    expect(normalizeVendorNameLoose("Zimmer Biomet")).toBe("zimmer biomet")
    // "Costco" ends in "co" only as part of the word — the regex requires
    // a separator (comma/period/whitespace) before the suffix.
    expect(normalizeVendorNameLoose("Costco")).toBe("costco")
  })
})

describe("vendorNamesLooselyMatch", () => {
  it("is case-insensitive (repo convention: never compare vendor names raw)", () => {
    expect(vendorNamesLooselyMatch("ARTHREX", "arthrex")).toBe(true)
  })

  it("tolerates suffix drift in either direction", () => {
    expect(vendorNamesLooselyMatch("Arthrex, Inc.", "Arthrex")).toBe(true)
    expect(vendorNamesLooselyMatch("Arthrex", "Arthrex Inc")).toBe(true)
  })

  it("rejects genuinely different vendors", () => {
    expect(vendorNamesLooselyMatch("Arthrex, Inc.", "Johnson & Johnson")).toBe(
      false,
    )
  })

  it("rejects null/empty on either side", () => {
    expect(vendorNamesLooselyMatch(null, "Arthrex")).toBe(false)
    expect(vendorNamesLooselyMatch("Arthrex", "")).toBe(false)
    expect(vendorNamesLooselyMatch("  ", "  ")).toBe(false)
  })
})

describe("matchVendorOptionByName", () => {
  const vendors = [
    { id: "v1", name: "Arthrex", displayName: "Arthrex, Inc." },
    { id: "v2", name: "Johnson & Johnson", displayName: null },
    { id: "v3", name: "Stryker Ortho", displayName: null },
    { id: "v4", name: "Stryker Endoscopy", displayName: null },
  ]

  it("matches the detected name case-insensitively against name", () => {
    expect(matchVendorOptionByName(vendors, "johnson & johnson")?.id).toBe("v2")
  })

  it("matches against displayName with suffix tolerance", () => {
    expect(matchVendorOptionByName(vendors, "ARTHREX INC")?.id).toBe("v1")
  })

  it("returns null when no option matches", () => {
    expect(matchVendorOptionByName(vendors, "DePuy Synthes")).toBeNull()
  })

  it("returns null for empty/undefined detected names", () => {
    expect(matchVendorOptionByName(vendors, null)).toBeNull()
    expect(matchVendorOptionByName(vendors, "   ")).toBeNull()
  })

  it("returns null when the name is ambiguous across options", () => {
    const ambiguous = [
      { id: "a", name: "Acme", displayName: null },
      { id: "b", name: "ACME", displayName: null },
    ]
    expect(matchVendorOptionByName(ambiguous, "acme")).toBeNull()
  })
})
