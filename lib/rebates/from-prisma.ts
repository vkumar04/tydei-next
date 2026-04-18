/**
 * Prisma-to-unified-engine bridge.
 *
 * Reference: docs/superpowers/specs/2026-04-18-rebate-term-types-extension.md §4.9
 *
 * Converts a Prisma `ContractTerm` + its `ContractTier`s into the
 * discriminated `RebateConfig` shape the unified engine expects, then
 * calls `calculateRebate`. Server actions with Prisma-loaded terms
 * use this wrapper instead of hand-crafting the config each time.
 *
 * Only covers the 3 most common term types today — SPEND_REBATE,
 * VOLUME_REBATE, CARVE_OUT — with safe fallback to SPEND_REBATE for
 * anything else. Additional type mappings land as the schema adds the
 * fields they need (price-reduction-trigger, capitated refs, etc.).
 */
import type {
  ContractTerm,
  ContractTier,
  RebateMethod,
} from "@prisma/client"
import {
  calculateRebate,
  type PeriodData,
  type RebateConfig,
  type RebateResult,
} from "@/lib/rebates/engine"
import type {
  BaselineType,
  RebateTier,
  SpendBasis,
  TierBoundaryRule,
  TierMethod,
} from "@/lib/rebates/engine/types"

type PrismaTermWithTiers = ContractTerm & {
  tiers: ContractTier[]
}

function methodToEngine(m: RebateMethod | null | undefined): TierMethod {
  return m === "marginal" ? "MARGINAL" : "CUMULATIVE"
}

function boundaryToEngine(
  b: ContractTerm["boundaryRule"] | null | undefined,
): TierBoundaryRule {
  return b === "inclusive" ? "INCLUSIVE" : "EXCLUSIVE"
}

function baselineToEngine(
  term: PrismaTermWithTiers,
): BaselineType {
  if (term.growthOnly && term.negotiatedBaseline != null) {
    return "NEGOTIATED_FIXED"
  }
  if (term.growthOnly) {
    return "PRIOR_YEAR_ACTUAL"
  }
  return "NONE"
}

function tiersToEngine(tiers: ContractTier[]): RebateTier[] {
  return tiers
    .slice()
    .sort((a, b) => a.tierNumber - b.tierNumber)
    .map((t) => ({
      tierNumber: t.tierNumber,
      tierName: t.tierName ?? null,
      thresholdMin: Number(t.spendMin),
      thresholdMax: t.spendMax === null ? null : Number(t.spendMax),
      rebateValue: Number(t.rebateValue),
      reducedPrice: t.reducedPrice === null ? null : Number(t.reducedPrice),
      priceReductionPercent:
        t.priceReductionPercent === null
          ? null
          : Number(t.priceReductionPercent),
      fixedRebateAmount:
        t.fixedRebateAmount === null ? null : Number(t.fixedRebateAmount),
    }))
}

/**
 * Build the engine's discriminated config for a Prisma ContractTerm.
 * Unsupported term types fall back to SPEND_REBATE / ALL_SPEND / NONE
 * (safe default — the engine still computes and returns a result).
 */
export function buildConfigFromPrismaTerm(
  term: PrismaTermWithTiers,
): RebateConfig {
  const tiers = tiersToEngine(term.tiers)
  const method = methodToEngine(term.rebateMethod)
  const boundaryRule = boundaryToEngine(term.boundaryRule)

  switch (term.termType) {
    case "volume_rebate":
      return {
        type: "VOLUME_REBATE",
        method,
        boundaryRule,
        tiers,
        cptCodes: term.cptCodes ?? [],
        baselineType: baselineToEngine(term),
        negotiatedBaseline:
          term.negotiatedBaseline === null
            ? null
            : Number(term.negotiatedBaseline),
        growthOnly: term.growthOnly ?? false,
        fixedRebatePerOccurrence:
          term.fixedRebatePerOccurrence === null
            ? null
            : Number(term.fixedRebatePerOccurrence),
      }

    case "carve_out": {
      // Carve-out uses per-line config, not tiers. ContractTier shape
      // doesn't encode line reference numbers today, so fall back to
      // SPEND_REBATE. When the schema adds per-carve-out lines (future
      // subsystem), replace this branch with a proper CarveOutConfig
      // builder.
      return {
        type: "SPEND_REBATE",
        method,
        boundaryRule,
        tiers,
        spendBasis: "ALL_SPEND" as SpendBasis,
        baselineType: "NONE",
      }
    }

    case "spend_rebate":
    default: {
      const referenceNumbers = term.referenceNumbers ?? []
      const categories = term.categories ?? []

      let spendBasis: SpendBasis = "ALL_SPEND"
      if (referenceNumbers.length > 0) {
        spendBasis = "REFERENCE_NUMBER"
      } else if (categories.length > 1) {
        spendBasis = "MULTI_CATEGORY"
      } else if (categories.length === 1) {
        spendBasis = "PRODUCT_CATEGORY"
      }

      return {
        type: "SPEND_REBATE",
        method,
        boundaryRule,
        tiers,
        spendBasis,
        baselineType: baselineToEngine(term),
        negotiatedBaseline:
          term.negotiatedBaseline === null
            ? null
            : Number(term.negotiatedBaseline),
        growthOnly: term.growthOnly ?? false,
        referenceNumbers,
        productCategory: categories.length === 1 ? (categories[0] ?? null) : null,
        categories,
      }
    }
  }
}

/**
 * End-to-end convenience: build a config from a Prisma term and call
 * the unified engine. Callers that only have a term + spend number
 * should keep using `computeRebateFromPrismaTiers` (the older facade);
 * this wrapper is for callers with a full PeriodData (purchases,
 * baselines, category spend, etc.).
 */
export function computeRebateFromPrismaTerm(
  term: PrismaTermWithTiers,
  periodData: PeriodData,
  options?: { periodLabel?: string | null },
): RebateResult {
  const config = buildConfigFromPrismaTerm(term)
  return calculateRebate(config, periodData, options)
}
