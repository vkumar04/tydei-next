import { describe, it, expect } from "vitest"
import { dealScoreSchema, extractedContractSchema } from "@/lib/ai/schemas"

/** Anthropic's Messages API rejects JSON Schema `minimum`/`maximum` on `number`
 * types. Zod .min().max() on numbers compile to those keywords via the AI SDK.
 * Guard the schema by asserting no numeric leaf has min/max constraints. */
describe("dealScoreSchema — Anthropic compatibility", () => {
  it("has no min/max constraints on numeric fields", () => {
    const json = JSON.stringify(dealScoreSchema._def, (_, v) =>
      typeof v === "bigint" ? String(v) : v,
    )
    // Zod v3 serializes number checks as { kind: "min" | "max", value: N } in
    // _def.checks. Zod v4 surfaces them as `minValue` / `maxValue` on the
    // numeric schema. Either representation causes the AI SDK to emit JSON
    // Schema `minimum`/`maximum` keywords, which Anthropic's Messages API
    // rejects with a 400.
    expect(json).not.toMatch(/"kind":"min"/)
    expect(json).not.toMatch(/"kind":"max"/)
    expect(json).not.toMatch(/"minValue":\s*\d/)
    expect(json).not.toMatch(/"maxValue":\s*\d/)
  })
})

function countUnionLeaves(def: unknown): number {
  const seen = new Set<unknown>()
  let count = 0
  function walk(node: unknown) {
    if (!node || typeof node !== "object" || seen.has(node)) return
    seen.add(node)
    const obj = node as Record<string, unknown>
    // Zod "optional" / "nullable" / "union" types each compile to a union
    // in JSON Schema.
    if (
      obj.typeName === "ZodOptional" ||
      obj.typeName === "ZodNullable" ||
      obj.typeName === "ZodUnion"
    ) {
      count += 1
    }
    for (const v of Object.values(obj)) walk(v)
  }
  walk(def)
  return count
}

describe("extract schemas — Anthropic tool-input compatibility", () => {
  it("extractedContractSchema has at most 18 union-typed leaves", () => {
    expect(countUnionLeaves(extractedContractSchema._def)).toBeLessThanOrEqual(18)
  })
})

describe("extractedContractSchema — variable pay periods", () => {
  // A minimal-but-complete extracted contract with one term that carries
  // the new variable-pay-period fields.
  const baseContract = {
    contractName: "Acme Spine Rebate Agreement",
    vendorName: "Acme",
    contractType: "usage" as const,
    effectiveDate: "2026-01-01",
    expirationDate: "2026-12-31",
    terms: [
      {
        termName: "Spend Rebate",
        termType: "spend_rebate",
        tiers: [
          {
            tierNumber: 1,
            spendMin: 0,
            rebateType: "percent_of_spend",
            rebateValue: 3,
          },
        ],
      },
    ],
  }

  it("round-trips hasVariablePayPeriods + payPeriodDetail on a term", () => {
    const input = {
      ...baseContract,
      terms: [
        {
          ...baseContract.terms[0],
          paymentTiming: "quarterly" as const,
          hasVariablePayPeriods: true,
          payPeriodDetail: "Paid 60 days after quarter-end",
        },
      ],
    }
    const parsed = extractedContractSchema.parse(input)
    expect(parsed.terms[0]!.hasVariablePayPeriods).toBe(true)
    expect(parsed.terms[0]!.payPeriodDetail).toBe(
      "Paid 60 days after quarter-end",
    )
  })

  it("parses an older-shape term WITHOUT the new fields (backward compat)", () => {
    const parsed = extractedContractSchema.parse(baseContract)
    expect(parsed.terms[0]!.hasVariablePayPeriods).toBeUndefined()
    expect(parsed.terms[0]!.payPeriodDetail).toBeUndefined()
  })
})

describe("mergeExtractedContracts — variable pay periods survive merge", () => {
  it("keeps hasVariablePayPeriods/payPeriodDetail from whichever chunk set them", async () => {
    const { mergeExtractedContracts } = await import(
      "@/lib/ai/contract-extract-merger"
    )
    // Chunk 1: header + the term WITHOUT variable-period detail (e.g. a
    // cover page that lists the term name but not the payment footnote).
    const chunk1 = {
      contractName: "Acme Spine Rebate Agreement",
      vendorName: "Acme",
      contractType: "usage" as const,
      effectiveDate: "2026-01-01",
      expirationDate: "2026-12-31",
      terms: [
        {
          termName: "Spend Rebate",
          termType: "spend_rebate",
          tiers: [{ tierNumber: 1, spendMin: 0, rebateValue: 3 }],
        },
      ],
    }
    // Chunk 2: SAME term (same name+type) but now with the variable-period
    // footnote, and one MORE tier so the "more tiers wins" rule selects it.
    const chunk2 = {
      ...chunk1,
      terms: [
        {
          termName: "Spend Rebate",
          termType: "spend_rebate",
          paymentTiming: "quarterly" as const,
          hasVariablePayPeriods: true,
          payPeriodDetail: "Paid 60 days after quarter-end",
          tiers: [
            { tierNumber: 1, spendMin: 0, rebateValue: 3 },
            { tierNumber: 2, spendMin: 100000, rebateValue: 5 },
          ],
        },
      ],
    }
    const merged = mergeExtractedContracts([chunk1, chunk2])
    expect(merged.terms).toHaveLength(1)
    expect(merged.terms[0]!.hasVariablePayPeriods).toBe(true)
    expect(merged.terms[0]!.payPeriodDetail).toBe(
      "Paid 60 days after quarter-end",
    )
  })
})
