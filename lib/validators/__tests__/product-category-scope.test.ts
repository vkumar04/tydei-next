/**
 * bugs.rtfd 2026-06-13 #5 (Vick): "When you select product category units it
 * needs to make you select categories in product scope; All Products should no
 * longer be an option."
 *
 * When a volume_rebate term counts volume by product category
 * (`volumeType === "product_category"`), the scope MUST be a specific category
 * with at least one category chosen — All Products / empty scope is rejected.
 * Both schema entry points (`createTermSchemaWithTierCheck`,
 * `termFormSchemaWithTierCheck`) enforce it via `refineProductCategoryScope`.
 */
import { describe, it, expect } from "vitest"
import {
  createTermSchemaWithTierCheck,
  termFormSchemaWithTierCheck,
} from "../contract-terms"

const SCOPE_MESSAGE =
  "Select at least one product category — 'Product category (units)' counts volume by category, so the scope can't be All Products."

// Minimal valid base for a create-term payload (contractId required) and the
// form payload (no contractId). Tier-ordering passes with a single tier.
function createBase() {
  return {
    contractId: "contract_1",
    termName: "Volume term",
    termType: "volume_rebate" as const,
    effectiveStart: "2026-01-01",
    effectiveEnd: "2026-12-31",
    tiers: [{ tierNumber: 1, spendMin: 0, rebateValue: 0 }],
  }
}

function formBase() {
  return {
    termName: "Volume term",
    termType: "volume_rebate" as const,
    effectiveStart: "2026-01-01",
    effectiveEnd: "2026-12-31",
    tiers: [{ tierNumber: 1, spendMin: 0, rebateValue: 0 }],
  }
}

function hasScopeIssue(issues: Array<{ message: string }>): boolean {
  return issues.some((i) => i.message === SCOPE_MESSAGE)
}

describe("refineProductCategoryScope — createTermSchemaWithTierCheck", () => {
  it("rejects product_category + all_products", () => {
    const result = createTermSchemaWithTierCheck.safeParse({
      ...createBase(),
      volumeType: "product_category",
      appliesTo: "all_products",
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(hasScopeIssue(result.error.issues)).toBe(true)
    }
  })

  it("rejects product_category + specific_category with empty categories", () => {
    const result = createTermSchemaWithTierCheck.safeParse({
      ...createBase(),
      volumeType: "product_category",
      appliesTo: "specific_category",
      scopedCategoryIds: [],
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(hasScopeIssue(result.error.issues)).toBe(true)
    }
  })

  it("passes product_category + specific_category with ≥1 category", () => {
    const result = createTermSchemaWithTierCheck.safeParse({
      ...createBase(),
      volumeType: "product_category",
      appliesTo: "specific_category",
      scopedCategoryIds: ["cat_1"],
      scopedCategoryId: "cat_1",
    })
    expect(result.success).toBe(true)
  })

  it("does NOT touch non-product_category terms with all_products (no regression)", () => {
    const result = createTermSchemaWithTierCheck.safeParse({
      ...createBase(),
      volumeType: "all_products",
      appliesTo: "all_products",
    })
    expect(result.success).toBe(true)
  })

  it("does NOT touch a procedure_code volume term scoped to all_products", () => {
    const result = createTermSchemaWithTierCheck.safeParse({
      ...createBase(),
      volumeType: "procedure_code",
      appliesTo: "all_products",
    })
    expect(result.success).toBe(true)
  })
})

describe("refineProductCategoryScope — termFormSchemaWithTierCheck", () => {
  it("rejects product_category + all_products", () => {
    const result = termFormSchemaWithTierCheck.safeParse({
      ...formBase(),
      volumeType: "product_category",
      appliesTo: "all_products",
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(hasScopeIssue(result.error.issues)).toBe(true)
    }
  })

  it("rejects product_category + specific_category with empty categories", () => {
    const result = termFormSchemaWithTierCheck.safeParse({
      ...formBase(),
      volumeType: "product_category",
      appliesTo: "specific_category",
      scopedCategoryIds: [],
    })
    expect(result.success).toBe(false)
  })

  it("passes product_category + specific_category with ≥1 category", () => {
    const result = termFormSchemaWithTierCheck.safeParse({
      ...formBase(),
      volumeType: "product_category",
      appliesTo: "specific_category",
      scopedCategoryIds: ["cat_1"],
      scopedCategoryId: "cat_1",
    })
    expect(result.success).toBe(true)
  })

  it("passes a non-product_category term with all_products (no regression)", () => {
    const result = termFormSchemaWithTierCheck.safeParse({
      ...formBase(),
      termType: "spend_rebate",
      volumeType: undefined,
      appliesTo: "all_products",
    })
    expect(result.success).toBe(true)
  })
})
