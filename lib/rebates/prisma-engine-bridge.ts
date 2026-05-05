/**
 * Prisma ↔ engine RebateConfig bridge.
 *
 * Maps a Prisma `ContractTerm` (with eagerly-loaded `tiers`) into the
 * engine's `RebateConfig` discriminated union so per-type calculators
 * in `lib/rebates/engine/*` can run on real data without each caller
 * hand-stitching the conversion.
 *
 * Provenance: required by Charles canonical engine wiring 2026-05-05.
 * See:
 *   - docs/superpowers/audits/2026-05-04-vendor-rebate-audit.md gap #8
 *   - docs/superpowers/audits/2026-05-05-v0-cross-check-pending-items.md
 *
 * Returns `null` when the term doesn't fit any engine config pattern;
 * callers should fall back to their existing hand-rolled path and
 * surface a warning.
 *
 * UNIT CONVENTION (CLAUDE.md "Rebate engine units"): Prisma stores
 * `ContractTier.rebateValue` as a fraction (0.02 = 2%) for
 * `percent_of_spend` tiers. The engine expects integer percent (2).
 * We route ALL scaling through `scaleRebateValueForEngine` so the
 * convention is owned by one helper.
 */
import type {
  ContractTerm as PrismaContractTerm,
  ContractTier as PrismaContractTier,
} from "@prisma/client"
import { scaleRebateValueForEngine } from "@/lib/rebates/calculate"
import type {
  BaselineType,
  CapitatedConfig,
  MarketShareRebateConfig,
  RebateConfig,
  RebateTier,
  SpendBasis,
  SpendRebateConfig,
  TierBoundaryRule,
  TierMethod,
  TierPriceReductionConfig,
  VolumeRebateConfig,
} from "@/lib/rebates/engine/types"

/**
 * Shape of the input we accept — a ContractTerm row with tiers eagerly
 * loaded. Keeps the bridge decoupled from the exact Prisma `include`
 * shape callers use.
 */
export type PrismaTermWithTiers = PrismaContractTerm & {
  tiers: PrismaContractTier[]
}

// ─── Tier mapping ───────────────────────────────────────────────

/**
 * Map a Prisma ContractTier row into the engine's `RebateTier` shape.
 *
 * For `percent_of_spend`, scale the fraction up to integer percent.
 * For `fixed_rebate`, route the dollar amount through `fixedRebateAmount`
 * so cumulative/marginal helpers short-circuit to the flat amount on
 * tier qualification (see `lib/rebates/calculate.ts` for the same
 * convention used by the flat-tier facade).
 *
 * For unit-based types (`fixed_rebate_per_unit`, `per_procedure_rebate`)
 * the rebateValue is already in dollars-per-unit and we pass it through
 * unchanged.
 */
function mapTier(t: PrismaContractTier): RebateTier {
  const isFixedRebate = t.rebateType === "fixed_rebate"
  return {
    tierNumber: t.tierNumber,
    tierName: t.tierName ?? null,
    thresholdMin: Number(t.spendMin),
    thresholdMax:
      t.spendMax === null || t.spendMax === undefined
        ? null
        : Number(t.spendMax),
    rebateValue: isFixedRebate
      ? 0
      : scaleRebateValueForEngine(t.rebateValue, t.rebateType),
    fixedRebateAmount: isFixedRebate
      ? Number(t.rebateValue)
      : t.fixedRebateAmount === null || t.fixedRebateAmount === undefined
        ? null
        : Number(t.fixedRebateAmount),
    reducedPrice:
      t.reducedPrice === null || t.reducedPrice === undefined
        ? null
        : Number(t.reducedPrice),
    priceReductionPercent:
      t.priceReductionPercent === null ||
      t.priceReductionPercent === undefined
        ? null
        : Number(t.priceReductionPercent),
  }
}

// ─── Sub-helpers ────────────────────────────────────────────────

function mapMethod(rebateMethod: string | null | undefined): TierMethod {
  return rebateMethod === "marginal" ? "MARGINAL" : "CUMULATIVE"
}

function mapBoundaryRule(
  rule: string | null | undefined,
): TierBoundaryRule {
  // Default to EXCLUSIVE — every flat-tier caller in the codebase
  // hardcodes EXCLUSIVE today (see lib/rebates/calculate.ts:122,163),
  // so preserve that convention when the column is null.
  return rule === "inclusive" ? "INCLUSIVE" : "EXCLUSIVE"
}

function mapBaselineType(
  baselineType: string | null | undefined,
  hasNegotiated: boolean,
): BaselineType {
  if (baselineType === "growth_based") return "PRIOR_YEAR_ACTUAL"
  if (hasNegotiated) return "NEGOTIATED_FIXED"
  return "NONE"
}

function mapSpendBasis(
  appliesTo: string | null | undefined,
  categories: string[] | null | undefined,
  referenceNumbers: string[] | null | undefined,
): SpendBasis {
  if (appliesTo === "specific_reference" || (referenceNumbers?.length ?? 0) > 0) {
    return "REFERENCE_NUMBER"
  }
  if (appliesTo === "specific_category" && (categories?.length ?? 0) > 1) {
    return "MULTI_CATEGORY"
  }
  if (appliesTo === "specific_category") {
    return "PRODUCT_CATEGORY"
  }
  return "ALL_SPEND"
}

// ─── Per-type builders ──────────────────────────────────────────

function buildSpendRebateConfig(
  term: PrismaTermWithTiers,
): SpendRebateConfig {
  const tiers = term.tiers.map(mapTier)
  const hasNegotiated =
    term.negotiatedBaseline !== null && term.negotiatedBaseline !== undefined
  const spendBasis = mapSpendBasis(
    term.appliesTo,
    term.categories,
    term.referenceNumbers,
  )
  return {
    type: "SPEND_REBATE",
    method: mapMethod(term.rebateMethod),
    boundaryRule: mapBoundaryRule(term.boundaryRule),
    tiers,
    spendBasis,
    baselineType: mapBaselineType(term.baselineType, hasNegotiated),
    negotiatedBaseline: hasNegotiated
      ? Number(term.negotiatedBaseline)
      : null,
    growthOnly: term.growthOnly ?? false,
    referenceNumbers:
      spendBasis === "REFERENCE_NUMBER" && term.referenceNumbers?.length
        ? term.referenceNumbers
        : undefined,
    productCategory:
      spendBasis === "PRODUCT_CATEGORY" && term.categories?.length
        ? term.categories[0]!
        : null,
    categories:
      spendBasis === "MULTI_CATEGORY" && term.categories?.length
        ? term.categories
        : undefined,
  }
}

function buildVolumeRebateConfig(
  term: PrismaTermWithTiers,
): VolumeRebateConfig {
  const tiers = term.tiers.map(mapTier)
  const hasNegotiated =
    term.negotiatedBaseline !== null && term.negotiatedBaseline !== undefined
  return {
    type: "VOLUME_REBATE",
    method: mapMethod(term.rebateMethod),
    boundaryRule: mapBoundaryRule(term.boundaryRule),
    tiers,
    cptCodes: term.cptCodes ?? [],
    baselineType: mapBaselineType(term.baselineType, hasNegotiated),
    negotiatedBaseline: hasNegotiated
      ? Number(term.negotiatedBaseline)
      : null,
    growthOnly: term.growthOnly ?? false,
    fixedRebatePerOccurrence:
      term.fixedRebatePerOccurrence === null ||
      term.fixedRebatePerOccurrence === undefined
        ? null
        : Number(term.fixedRebatePerOccurrence),
  }
}

function buildTierPriceReductionConfig(
  term: PrismaTermWithTiers,
): TierPriceReductionConfig {
  const tiers = term.tiers.map(mapTier)
  const spendBasis = mapSpendBasis(
    term.appliesTo,
    term.categories,
    term.referenceNumbers,
  )
  const trigger = term.priceReductionTrigger === "forward_only"
    ? "FORWARD_ONLY"
    : "RETROACTIVE"
  return {
    type: "TIER_PRICE_REDUCTION",
    boundaryRule: mapBoundaryRule(term.boundaryRule),
    tiers,
    spendBasis,
    trigger,
    referenceNumbers:
      spendBasis === "REFERENCE_NUMBER" && term.referenceNumbers?.length
        ? term.referenceNumbers
        : undefined,
    productCategory:
      spendBasis === "PRODUCT_CATEGORY" && term.categories?.length
        ? term.categories[0]!
        : null,
    categories:
      spendBasis === "MULTI_CATEGORY" && term.categories?.length
        ? term.categories
        : undefined,
  }
}

function buildMarketShareRebateConfig(
  term: PrismaTermWithTiers,
): MarketShareRebateConfig {
  return {
    type: "MARKET_SHARE_REBATE",
    method: mapMethod(term.rebateMethod),
    boundaryRule: mapBoundaryRule(term.boundaryRule),
    tiers: term.tiers.map(mapTier),
    marketShareVendorId: term.marketShareVendorId ?? null,
    marketShareCategory: term.marketShareCategory ?? null,
  }
}

function buildCapitatedConfig(
  term: PrismaTermWithTiers,
): CapitatedConfig | null {
  if (term.periodCap === null || term.periodCap === undefined) return null
  return {
    type: "CAPITATED",
    groupedReferenceNumbers: term.groupedReferenceNumbers ?? [],
    periodCap: Number(term.periodCap),
    embeddedRebate:
      term.tiers.length > 0 ? buildSpendRebateConfig(term) : null,
  }
}

// ─── Main entry point ───────────────────────────────────────────

/**
 * Build a `RebateConfig` for the engine from a Prisma `ContractTerm`
 * row + tiers. Returns `null` when the term doesn't fit any pattern
 * (caller should fall back to its existing hand-rolled path and log).
 *
 * Mapping rules:
 *   - `volume_rebate` / `rebate_per_use` / `capitated_pricing_rebate` →
 *     VOLUME_REBATE (CPT-occurrence semantics).
 *   - `price_reduction` → TIER_PRICE_REDUCTION
 *   - `market_share` → MARKET_SHARE_REBATE
 *   - `capitated_price_reduction` → CAPITATED (with embedded sub-engine
 *     when tiers present).
 *   - `carve_out` → returns null (the carve-out engine takes a different
 *     config built from per-line ContractPricing rows; see
 *     `lib/contracts/recompute/carve-out.ts`).
 *   - Everything else (spend_rebate, growth_rebate, po_rebate,
 *     payment_rebate, compliance_rebate, fixed_fee, locked_pricing) →
 *     SPEND_REBATE as a sensible default.
 *
 * A term with zero tiers AND no `periodCap` returns null — there's
 * nothing for the engine to compute.
 */
export function buildRebateConfigFromPrisma(
  term: PrismaTermWithTiers,
): RebateConfig | null {
  if (term.tiers.length === 0 && term.periodCap === null) {
    return null
  }

  switch (term.termType) {
    case "volume_rebate":
    case "rebate_per_use":
    case "capitated_pricing_rebate":
      return buildVolumeRebateConfig(term)

    case "price_reduction":
      return buildTierPriceReductionConfig(term)

    case "market_share":
    case "market_share_price_reduction":
      // market_share_price_reduction has its own engine but tydei's
      // schema doesn't yet distinguish the two with a separate column;
      // fall back to the rebate variant which is the more conservative
      // mapping (cash rebate on share threshold).
      return buildMarketShareRebateConfig(term)

    case "capitated_price_reduction":
      return buildCapitatedConfig(term)

    case "carve_out":
      // Carve-out has a separate config shape sourced from
      // ContractPricing rows. The recompute pipeline routes carve_out
      // terms through `lib/contracts/recompute/carve-out.ts` directly;
      // returning null here signals "the bridge can't help".
      return null

    case "spend_rebate":
    case "growth_rebate":
    case "po_rebate":
    case "payment_rebate":
    case "compliance_rebate":
    case "fixed_fee":
    case "locked_pricing":
    default:
      return buildSpendRebateConfig(term)
  }
}
