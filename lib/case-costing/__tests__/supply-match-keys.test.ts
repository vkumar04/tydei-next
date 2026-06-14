/**
 * supplyMatchKeys — supply→contract SKU key derivation.
 *
 * 2026-06-14: real clinical case exports leave `vendorItemNo` blank or "-"
 * and carry the catalog number in the material-description tail
 * ("ANCHOR … WITHOUT T - SMK100101"). The supply-on-contract matcher keyed
 * only on `vendorItemNo`, so every supply read as off-contract (flat 0%
 * On-Contract). These tests pin the vendorItemNo→materialName fallback.
 */
import { describe, it, expect } from "vitest"
import { supplyMatchKeys } from "@/lib/case-costing/recompute-supply"

describe("supplyMatchKeys", () => {
  it("uses vendorItemNo when it is a real catalog number", () => {
    expect(supplyMatchKeys("AR-9835", "Some Anchor")).toEqual(["ar-9835"])
  })

  it("falls back to the SKU in the material-description tail", () => {
    expect(
      supplyMatchKeys(
        "-",
        "ANCHOR FORCE FIBER SUTURE BLUE WHITE COBRAID 2 36IN PRECUT WITHOUT T - SMK100101",
      ),
    ).toEqual(["smk100101"])
  })

  it("treats blank / '-' vendorItemNo as absent", () => {
    expect(supplyMatchKeys("", "Plain name with no sku")).toEqual([])
    expect(supplyMatchKeys("-", "Plain name with no sku")).toEqual([])
    expect(supplyMatchKeys(null, null)).toEqual([])
  })

  it("returns BOTH keys (vendorItemNo + name tail) de-duplicated", () => {
    expect(supplyMatchKeys("CAT01386", "Anchor Suture Nanotack - SMK999")).toEqual([
      "cat01386",
      "smk999",
    ])
    // identical key from both sources collapses to one
    expect(supplyMatchKeys("SMK100101", "Whatever - SMK100101")).toEqual([
      "smk100101",
    ])
  })

  it("normalizes case and whitespace (mirrors normalizeSku)", () => {
    expect(supplyMatchKeys("  Ar-9835  ", null)).toEqual(["ar-9835"])
    // only the LAST ' - ' segment is the SKU
    expect(supplyMatchKeys(null, "MULTI - PART - DESC - 72200080")).toEqual([
      "72200080",
    ])
  })
})
