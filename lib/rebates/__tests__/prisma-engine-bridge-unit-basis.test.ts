/**
 * Bridge unit-basis regression (2026-07-29 math audit, CRITICAL).
 *
 * `mapTier` used to apply a ×100 to per-unit dollar tiers on the strength of
 * `rebateType` ALONE, ignoring what the engine would multiply the result
 * against. The ×100 exists to cancel the engine's internal `/100` so that
 * `(count × ($X × 100)) / 100 = count × $X` — which is right only when
 * `eligibleAmount` is an occurrence COUNT.
 *
 * `buildRebateConfigFromPrisma` routes po_rebate / payment_rebate /
 * compliance_rebate / fixed_fee / locked_pricing / spend_rebate to
 * SPEND_REBATE, where `eligibleAmount` is DOLLARS. A $100-per-PO tier on
 * $500,000 of spend therefore produced (500000 × 10000) / 100 = $50,000,000.
 *
 * The guard that matters is the SPEND arm. The VOLUME arm is here to prove the
 * fix did not break the case the ×100 was written for — a fix that trades one
 * wrong number for another is not a fix.
 */

import { describe, it, expect } from "vitest"
import { buildRebateConfigFromPrisma } from "../prisma-engine-bridge"
import type { PrismaTermWithTiers } from "../prisma-engine-bridge"

type AnyRec = Record<string, unknown>

/** Minimal ContractTier row; only the fields the bridge reads matter. */
function tier(over: AnyRec = {}): AnyRec {
  return {
    id: "tier_1",
    createdAt: new Date(0),
    termId: "term_1",
    tierNumber: 1,
    tierName: null,
    spendMin: 0,
    spendMax: null,
    volumeMin: null,
    volumeMax: null,
    marketShareMin: null,
    marketShareMax: null,
    rebateType: "fixed_rebate_per_unit",
    rebateValue: 100, // $100 per unit
    fixedRebateAmount: null,
    priceReductionPercent: null,
    reducedPrice: null,
    ...over,
  }
}

function term(over: AnyRec = {}): PrismaTermWithTiers {
  return {
    id: "term_1",
    contractId: "c1",
    termName: "t",
    termType: "po_rebate",
    baselineType: null,
    evaluationPeriod: "annual",
    paymentTiming: null,
    appliesTo: "all_products",
    effectiveStart: null,
    effectiveEnd: null,
    volumeType: null,
    spendBaseline: null,
    volumeBaseline: null,
    growthBaselinePercent: null,
    desiredMarketShare: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    rebateMethod: "cumulative",
    boundaryRule: null,
    categories: [],
    cptCodes: [],
    fixedRebatePerOccurrence: null,
    groupedReferenceNumbers: [],
    growthOnly: false,
    marketShareCategory: null,
    marketShareVendorId: null,
    negotiatedBaseline: null,
    periodCap: null,
    priceReductionTrigger: null,
    referenceNumbers: [],
    shortfallHandling: null,
    minimumPurchaseCommitment: null,
    adminFeePercent: null,
    tiers: [tier()],
    ...over,
  } as unknown as PrismaTermWithTiers
}

const rebateValueOf = (cfg: unknown): number =>
  ((cfg as { tiers: { rebateValue: number }[] }).tiers[0]!).rebateValue

describe("mapTier is aware of what the engine multiplies against", () => {
  // ── The regression. Dollar-basis destinations must NOT get the ×100. ──
  it.each([
    "spend_rebate",
    "po_rebate",
    "payment_rebate",
    "compliance_rebate",
    "fixed_fee",
    "locked_pricing",
  ])("%s (SPEND_REBATE) does not ×100 a per-unit dollar tier", (termType) => {
    const cfg = buildRebateConfigFromPrisma(term({ termType }))
    expect(cfg).not.toBeNull()
    expect((cfg as { type: string }).type).toBe("SPEND_REBATE")
    // 10000 was the shipped value and is what produced $50,000,000 on
    // $500,000 of spend. Anything that re-introduces it fails here.
    expect(rebateValueOf(cfg)).not.toBe(10000)
    expect(rebateValueOf(cfg)).toBe(0)
  })

  it("a $100/unit tier on $500,000 of spend can no longer yield $50,000,000", () => {
    const cfg = buildRebateConfigFromPrisma(term({ termType: "po_rebate" }))
    // Engine math for SPEND_REBATE: (eligibleAmount × rebateValue) / 100
    const earned = (500_000 * rebateValueOf(cfg)) / 100
    expect(earned).not.toBeCloseTo(50_000_000, 2)
    expect(earned).toBe(0)
  })

  // ── The case the ×100 was written for. Must still work. ──
  it.each(["volume_rebate", "rebate_per_use", "capitated_pricing_rebate"])(
    "%s (VOLUME_REBATE) still ×100 so count × $X survives the engine's /100",
    (termType) => {
      const cfg = buildRebateConfigFromPrisma(term({ termType }))
      expect((cfg as { type: string }).type).toBe("VOLUME_REBATE")
      expect(rebateValueOf(cfg)).toBe(10000)
      // 120 occurrences × $100 = $12,000
      expect((120 * rebateValueOf(cfg)) / 100).toBeCloseTo(12_000, 6)
    },
  )

  it("per_procedure_rebate follows the same basis rule as fixed_rebate_per_unit", () => {
    const vol = buildRebateConfigFromPrisma(
      term({
        termType: "volume_rebate",
        tiers: [tier({ rebateType: "per_procedure_rebate", rebateValue: 75 })],
      }),
    )
    const spend = buildRebateConfigFromPrisma(
      term({
        termType: "po_rebate",
        tiers: [tier({ rebateType: "per_procedure_rebate", rebateValue: 75 })],
      }),
    )
    expect(rebateValueOf(vol)).toBe(7500)
    expect(rebateValueOf(spend)).toBe(0)
  })

  // ── Untouched types must be unaffected by the new parameter. ──
  it("percent_of_spend scales identically on both bases", () => {
    const v = buildRebateConfigFromPrisma(
      term({
        termType: "volume_rebate",
        tiers: [tier({ rebateType: "percent_of_spend", rebateValue: 0.03 })],
      }),
    )
    const s = buildRebateConfigFromPrisma(
      term({
        termType: "spend_rebate",
        tiers: [tier({ rebateType: "percent_of_spend", rebateValue: 0.03 })],
      }),
    )
    expect(rebateValueOf(v)).toBeCloseTo(3, 10)
    expect(rebateValueOf(s)).toBeCloseTo(3, 10)
  })

  it("fixed_rebate still routes dollars through fixedRebateAmount, not rebateValue", () => {
    // The $30,000 -> $3,000,000 incident guard.
    const cfg = buildRebateConfigFromPrisma(
      term({
        termType: "spend_rebate",
        tiers: [tier({ rebateType: "fixed_rebate", rebateValue: 30000 })],
      }),
    )
    const t0 = (cfg as { tiers: { rebateValue: number; fixedRebateAmount: number | null }[] })
      .tiers[0]!
    expect(t0.rebateValue).toBe(0)
    expect(t0.fixedRebateAmount).toBe(30000)
  })
})
