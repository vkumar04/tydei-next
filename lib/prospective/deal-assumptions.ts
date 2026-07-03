/**
 * Deal-Scorer Step-1 assumptions persisted onto a proposal's `pricingData`
 * (`dealAssumptions` key) — the consolidation round-trip (Wave-2 D of the
 * 2026-07-03 prospective-structural-six plan): on Analyze the vendor's
 * typed assumptions are saved with the score, and re-opening the proposal
 * restores the Deal Scorer with ZERO re-entry.
 *
 * ONE schema, two consumers (never fork it — drift hazard):
 *   - write side: `runAnalysis` in lib/actions/vendor-prospective.ts
 *     (zod-validated JSON-column write, per CLAUDE.md)
 *   - read side: `getVendorProposalDetail` in lib/actions/prospective.ts
 *     (tolerant `safeParse` — proposals saved before this feature simply
 *     have no `dealAssumptions` key and read back as `undefined`)
 *
 * UNITS — deliberate, to avoid ×100 bugs: every `*Pct` field is stored as a
 * WHOLE percent (40 = 40%), the SAME units the Deal Scorer's string states
 * hold ("40", "5", …), so the UI restore is a plain `String(value)` with no
 * conversion. The analyzer input (`VendorProspectiveAnalysisInput`) holds
 * FRACTIONS (0.40) — the fraction→percent conversion happens exactly once,
 * at the persist boundary in `runAnalysis`. Dollar fields
 * (`estimatedSpend`, `internalUnitCost`, capital costs) are plain dollars.
 */
import { z } from "zod"
import type { VendorContractVariant } from "@/lib/prospective-analysis/vendor-prospective-analyzer"

const CONTRACT_VARIANTS = [
  "USAGE_SPEND",
  "USAGE_VOLUME",
  "USAGE_MARKET_SHARE",
  "CAPITAL_OUTRIGHT",
  "CAPITAL_LEASE",
  "CAPITAL_TIE_IN",
  "SERVICE_FIXED",
  "SERVICE_VARIABLE",
  "GPO",
  "PRICING_ONLY",
] as const satisfies readonly VendorContractVariant[]

// Compile-time exhaustiveness: if the analyzer union gains a variant that is
// missing above, this line stops compiling.
const _allVariantsCovered: [
  Exclude<VendorContractVariant, (typeof CONTRACT_VARIANTS)[number]>,
] extends [never]
  ? true
  : never = true
void _allVariantsCovered

export const dealAssumptionsSchema = z.object({
  /** Whole percent (40 = 40%) — UI-state units. */
  targetMarginPct: z.number(),
  /** Whole percent. */
  floorMarginPct: z.number(),
  /** Whole percent, null when the field was left blank. */
  currentSharePct: z.number().nullable(),
  /** Dollars — the typed "Facility estimated annual category spend". */
  estimatedSpend: z.number().nullable(),
  estimatedSpendCategory: z.string().nullable(),
  /** Dollars per unit, null when blank (55% GM fallback applied). */
  internalUnitCost: z.number().nullable(),
  contractVariant: z.enum(CONTRACT_VARIANTS),
  /** Capital block — null for non-capital deals / when no equipment cost. */
  capital: z
    .object({
      equipmentCost: z.number(),
      annualMaintenanceCost: z.number(),
      termMonths: z.number(),
      /** Whole percent (5 = 5%). */
      interestRatePct: z.number(),
      /** Whole percent (10 = 10%). */
      discountRatePct: z.number(),
    })
    .nullable(),
})

export type DealAssumptions = z.infer<typeof dealAssumptionsSchema>

/** Fraction → whole percent at the persist boundary (0.4 → 40), rounded to
 *  3 decimals so FP noise (0.07 × 100 = 7.000000000000001) never leaks into
 *  the stored value or the restored input string. */
export function fractionToWholePct(fraction: number): number {
  return Math.round(fraction * 100 * 1000) / 1000
}
