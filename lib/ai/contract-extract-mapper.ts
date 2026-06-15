import type { RichContractExtractData } from "@/lib/ai/schemas"

/**
 * Inverse of {@link toLegacyExtractedContract}: lift the FLAT
 * `ExtractedContractData` shape (what the /api/ai/extract-contract route
 * returns — `capitalCost` / `interestRatePercent` / `termMonths` /
 * `paymentCadence` / `downPayment`) into the RICH shape that
 * `ingestExtractedContracts` consumes (`tieInDetails.…`).
 *
 * 2026-06-15 (Vick "still not getting the capital"): the mass-upload flow
 * cast the flat extraction `as unknown as RichContractExtractData` and the
 * importer then read `tieInDetails?.capitalEquipmentValue` — always
 * undefined, so a perfectly-extracted capital value (e.g. the ROSA
 * tie-in's $785,195 Amount Financed) was silently dropped at the boundary.
 * Build tieInDetails from the flat fields so capital survives import.
 * Idempotent: a payload that already carries a non-null `tieInDetails`
 * (the rich path) is passed through untouched.
 */
export function toRichExtractedContract(
  flat: Record<string, unknown>,
): RichContractExtractData {
  type Cadence = "monthly" | "quarterly" | "semi_annual" | "annual"
  const f = flat as {
    tieInDetails?: RichContractExtractData["tieInDetails"]
    capitalCost?: number | null
    termMonths?: number | null
    interestRatePercent?: number | null
    paymentCadence?: Cadence | null
    downPayment?: number | null
  }

  const existing = f.tieInDetails
  const hasFlatCapital =
    f.capitalCost != null ||
    f.downPayment != null ||
    f.interestRatePercent != null ||
    f.termMonths != null

  const tieInDetails =
    existing ??
    (hasFlatCapital
      ? {
          capitalEquipmentValue: f.capitalCost ?? null,
          payoffPeriodMonths: f.termMonths ?? null,
          interestRatePercent: f.interestRatePercent ?? null,
          paymentCadence: f.paymentCadence ?? null,
          downPayment: f.downPayment ?? null,
          linkedProductCategories: null,
        }
      : null)

  return {
    ...(flat as unknown as RichContractExtractData),
    tieInDetails,
  }
}

/**
 * Project the rich contract extract shape into the legacy
 * `ExtractedContractData` shape so existing callers (AIExtractReview,
 * ai-extract-dialog, contract form hook) keep working unchanged.
 */
export function toLegacyExtractedContract(rich: RichContractExtractData) {
  return {
    contractName: rich.contractName ?? "Untitled Contract",
    contractNumber: rich.contractId ?? undefined,
    vendorName: rich.vendorName ?? "Unknown Vendor",
    contractType: rich.contractType ?? "usage",
    // Null effectiveDate is preserved as null (not coerced to today) —
    // ExtractedContractData now allows `string | null` to support
    // evergreen contracts end-to-end (see lib/ai/schemas.ts). Coercing
    // here would re-introduce the bug 4c31b15 fixed at a different
    // layer: a contract marked evergreen by the AI would get stamped
    // with today's date and expire by end of day.
    effectiveDate: rich.effectiveDate ?? null,
    expirationDate: rich.expirationDate ?? null,
    // Charles 2026-04-29 Bug B: don't squash equipment price into
    // totalValue. totalValue is the spend-commitment ceiling; the
    // equipment cost belongs in capitalCost (separate field). Pre-fix
    // this was the only way to surface the value at all, but the
    // form's capital input was always empty as a result.
    totalValue: undefined,
    capitalCost: rich.tieInDetails?.capitalEquipmentValue ?? undefined,
    termMonths: rich.tieInDetails?.payoffPeriodMonths ?? undefined,
    interestRatePercent:
      rich.tieInDetails?.interestRatePercent ?? undefined,
    paymentCadence: rich.tieInDetails?.paymentCadence ?? undefined,
    downPayment: rich.tieInDetails?.downPayment ?? undefined,
    description: rich.specialConditions?.join(" ") || undefined,
    terms: (rich.terms ?? []).map((t) => {
      // Charles 2026-04-26 (#80): the AI schema dropped spendMax /
      // volumeMax / marketShareMax to fit Anthropic's 24-optional cap
      // on structured outputs (see lib/ai/schemas.ts:224). The engine
      // derives each tier's ceiling from the next tier's min, but the
      // form UI still shows a "Spend Max" column and users expect to
      // see the implied ceiling pre-filled. Derive it here from the
      // next tier's spendMin (-1 to keep the bands non-overlapping,
      // mirroring the prompt rule "Tier (N+1).spendMin > Tier N.spendMax").
      // Top tier stays undefined (open-ended).
      const sortedTiers = [...(t.tiers ?? [])].sort(
        (a, b) => (a.tierNumber ?? 0) - (b.tierNumber ?? 0),
      )
      return {
        termName: t.termName,
        termType: t.termType ?? "spend_rebate",
        tiers: sortedTiers.map((tier, idx) => {
          const next = sortedTiers[idx + 1]
          const derivedSpendMax =
            tier.spendMax ??
            (next?.spendMin != null ? next.spendMin - 1 : undefined)
          return {
            tierNumber: tier.tierNumber,
            spendMin: tier.spendMin ?? undefined,
            spendMax: derivedSpendMax,
            rebateType: tier.rebateType ?? undefined,
            rebateValue: tier.rebateValue ?? undefined,
          }
        }),
      }
    }),
  }
}
