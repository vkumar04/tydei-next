"use server"

import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { contractOwnershipWhere } from "@/lib/actions/contracts-auth"
import { serialize } from "@/lib/serialize"

export interface OffContractSpendItem {
  vendorItemNo: string
  totalSpend: number
}

export interface OffContractSpendResult {
  /**
   * Spend on SKUs that matched the contract's pricing file.
   * matchStatus IN (on_contract, price_variance).
   */
  onContract: number
  /**
   * Spend on this contract's vendor where the SKU was NOT in the pricing file.
   * matchStatus === off_contract_item. This is a pricing gap, NOT leakage.
   */
  notPriced: number
  /**
   * Spend truly outside any contract (different vendor or unknown vendor).
   * matchStatus IN (out_of_scope, unknown_vendor).
   */
  offContract: number
  /** Top "Not Priced" items (vendor is on-contract, SKU isn't priced). */
  topNotPriced: OffContractSpendItem[]
  /** Top truly off-contract items. */
  topOffContract: OffContractSpendItem[]

  // --- Back-compat shims for legacy callers ---
  /** @deprecated alias for topOffContract. Kept for backward compatibility. */
  offContractItems: OffContractSpendItem[]
}

export async function getOffContractSpend(
  contractId: string,
): Promise<OffContractSpendResult> {
  const { facility } = await requireFacility()
  const contract = await prisma.contract.findUniqueOrThrow({
    where: contractOwnershipWhere(contractId, facility.id),
    select: { id: true, vendorId: true },
  })

  // Scope to rows enriched for this contract, plus un-enriched rows for the
  // same vendor (so pre-enrichment data still counts). This prevents spend
  // from a sibling contract on the same vendor from leaking in.
  const scopeOR = [
    { contractId: contract.id },
    { contractId: null, vendorId: contract.vendorId },
  ]

  const [onAgg, notPricedAgg, offAgg, notPricedItems, offItems] =
    await Promise.all([
      prisma.cOGRecord.aggregate({
        where: {
          facilityId: facility.id,
          OR: scopeOR,
          matchStatus: { in: ["on_contract", "price_variance"] },
        },
        _sum: { extendedPrice: true },
      }),
      prisma.cOGRecord.aggregate({
        where: {
          facilityId: facility.id,
          OR: scopeOR,
          matchStatus: "off_contract_item",
        },
        _sum: { extendedPrice: true },
      }),
      prisma.cOGRecord.aggregate({
        where: {
          facilityId: facility.id,
          OR: scopeOR,
          matchStatus: { in: ["out_of_scope", "unknown_vendor"] },
        },
        _sum: { extendedPrice: true },
      }),
      prisma.cOGRecord.groupBy({
        by: ["vendorItemNo"],
        where: {
          facilityId: facility.id,
          OR: scopeOR,
          matchStatus: "off_contract_item",
          vendorItemNo: { not: null },
        },
        _sum: { extendedPrice: true },
        orderBy: { _sum: { extendedPrice: "desc" } },
        take: 10,
      }),
      prisma.cOGRecord.groupBy({
        by: ["vendorItemNo"],
        where: {
          facilityId: facility.id,
          OR: scopeOR,
          matchStatus: { in: ["out_of_scope", "unknown_vendor"] },
          vendorItemNo: { not: null },
        },
        _sum: { extendedPrice: true },
        orderBy: { _sum: { extendedPrice: "desc" } },
        take: 10,
      }),
    ])

  const topNotPriced: OffContractSpendItem[] = notPricedItems
    .filter(
      (r): r is typeof r & { vendorItemNo: string } => r.vendorItemNo !== null,
    )
    .map((r) => ({
      vendorItemNo: r.vendorItemNo,
      totalSpend: Number(r._sum?.extendedPrice ?? 0),
    }))

  const topOffContract: OffContractSpendItem[] = offItems
    .filter(
      (r): r is typeof r & { vendorItemNo: string } => r.vendorItemNo !== null,
    )
    .map((r) => ({
      vendorItemNo: r.vendorItemNo,
      totalSpend: Number(r._sum?.extendedPrice ?? 0),
    }))

  return serialize({
    onContract: Number(onAgg._sum?.extendedPrice ?? 0),
    notPriced: Number(notPricedAgg._sum?.extendedPrice ?? 0),
    offContract: Number(offAgg._sum?.extendedPrice ?? 0),
    topNotPriced,
    topOffContract,
    // Legacy alias so older callers (and any stale cached queries) keep working.
    offContractItems: topOffContract,
  })
}
