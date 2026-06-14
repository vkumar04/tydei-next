/**
 * classifyPayorClass — raw carrier-string bucketing.
 *
 * 2026-06-14 ("I elected a payor and it still says no payor data"): real
 * case-upload files carry free-text carrier names, not the tidy seed
 * tokens. These tests pin the alias/substring matching so real exports
 * classify into the canonical payor-mix buckets instead of collapsing to
 * "other" (which read as "No payor data" on the Surgeons tab).
 */
import { describe, it, expect } from "vitest"
import { classifyPayorClass } from "@/lib/case-costing/payor-mix"

describe("classifyPayorClass", () => {
  it("returns null for blank/missing input", () => {
    expect(classifyPayorClass(null)).toBeNull()
    expect(classifyPayorClass(undefined)).toBeNull()
    expect(classifyPayorClass("")).toBeNull()
    expect(classifyPayorClass("   ")).toBeNull()
  })

  it("keeps the original seed tokens working", () => {
    expect(classifyPayorClass("commercial")).toBe("commercial")
    expect(classifyPayorClass("blue_cross")).toBe("commercial")
    expect(classifyPayorClass("aetna")).toBe("commercial")
    expect(classifyPayorClass("united")).toBe("commercial")
    expect(classifyPayorClass("medicare")).toBe("medicare")
    expect(classifyPayorClass("medicaid")).toBe("medicaid")
    expect(classifyPayorClass("private")).toBe("private")
    expect(classifyPayorClass("workers_comp")).toBe("workers_comp")
  })

  it("buckets real-world commercial carrier names", () => {
    expect(classifyPayorClass("Anthem BCBS")).toBe("commercial")
    expect(classifyPayorClass("Blue Cross Blue Shield")).toBe("commercial")
    expect(classifyPayorClass("UnitedHealthcare")).toBe("commercial")
    expect(classifyPayorClass("UHC")).toBe("commercial")
    expect(classifyPayorClass("Cigna PPO")).toBe("commercial")
    expect(classifyPayorClass("Humana")).toBe("commercial")
    expect(classifyPayorClass("Aetna Choice POS II")).toBe("commercial")
    expect(classifyPayorClass("Commercial HMO")).toBe("commercial")
  })

  it("classifies Medicare Advantage as medicare (not commercial)", () => {
    expect(classifyPayorClass("Medicare Advantage")).toBe("medicare")
    expect(classifyPayorClass("Aetna Medicare Advantage")).toBe("medicare")
    expect(classifyPayorClass("Traditional Medicare")).toBe("medicare")
  })

  it("classifies Medicaid (incl. managed Medicaid) before medicare/commercial", () => {
    expect(classifyPayorClass("Medicaid")).toBe("medicaid")
    expect(classifyPayorClass("Managed Medicaid")).toBe("medicaid")
  })

  it("buckets workers' comp variants", () => {
    expect(classifyPayorClass("Workers Comp")).toBe("workers_comp")
    expect(classifyPayorClass("Workers' Compensation")).toBe("workers_comp")
    expect(classifyPayorClass("Work Comp")).toBe("workers_comp")
    expect(classifyPayorClass("WC")).toBe("workers_comp")
  })

  it("buckets self-pay / private-pay as private", () => {
    expect(classifyPayorClass("Self-Pay")).toBe("private")
    expect(classifyPayorClass("Self Pay")).toBe("private")
    expect(classifyPayorClass("Private Pay")).toBe("private")
    expect(classifyPayorClass("Cash")).toBe("private")
  })

  it("falls back to other for unrecognized non-empty strings", () => {
    expect(classifyPayorClass("Tricare")).toBe("other")
    expect(classifyPayorClass("Some Unknown Plan XYZ")).toBe("other")
  })
})
