import type { RichContractExtractData } from "@/lib/ai/schemas"

/**
 * Project the rich contract extract shape into the legacy
 * `ExtractedContractData` shape so existing callers (AIExtractReview,
 * ai-extract-dialog, contract form hook) keep working unchanged.
 */
export function toLegacyExtractedContract(rich: RichContractExtractData) {
  const today = new Date().toISOString().split("T")[0]
  return {
    contractName: rich.contractName ?? "Untitled Contract",
    contractNumber: rich.contractId ?? undefined,
    vendorName: rich.vendorName ?? "Unknown Vendor",
    contractType: rich.contractType ?? "usage",
    effectiveDate: rich.effectiveDate ?? today,
    expirationDate: rich.expirationDate ?? today,
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
