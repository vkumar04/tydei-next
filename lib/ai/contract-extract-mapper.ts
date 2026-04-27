import type { RichContractExtractData } from "@/lib/ai/schemas"

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
    totalValue: rich.tieInDetails?.capitalEquipmentValue ?? undefined,
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
