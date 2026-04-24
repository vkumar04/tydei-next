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
    terms: (rich.terms ?? []).map((t) => ({
      termName: t.termName,
      termType: t.termType ?? "spend_rebate",
      tiers: (t.tiers ?? []).map((tier) => ({
        tierNumber: tier.tierNumber,
        spendMin: tier.spendMin ?? undefined,
        spendMax: tier.spendMax ?? undefined,
        rebateType: tier.rebateType ?? undefined,
        rebateValue: tier.rebateValue ?? undefined,
      })),
    })),
  }
}
