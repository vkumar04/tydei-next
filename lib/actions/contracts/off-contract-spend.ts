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
   * Same-vendor COG rows the matcher has not yet classified.
   * matchStatus === out_of_scope. NOT leakage — these SKUs are on this
   * contract's vendor but the match pipeline hasn't placed them yet
   * (e.g. pending match re-run, or the SKU is outside every contract's
   * priced list on the same vendor). Surfacing this bucket separately
   * stops it from inflating the "Off Contract" number.
   */
  preMatch: number
  /**
   * Spend truly outside any contract — different vendor or unknown vendor.
   * matchStatus === unknown_vendor.
   */
  offContract: number
  /** Top on-contract / price-variance items by spend. */
  topOnContract: OffContractSpendItem[]
  /** Top "Not Priced" items (vendor is on-contract, SKU isn't priced). */
  topNotPriced: OffContractSpendItem[]
  /** Top pre-match items (same-vendor out_of_scope). */
  topPreMatch: OffContractSpendItem[]
  /** Top truly off-contract items (unknown_vendor). */
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

  const [
    onAgg,
    notPricedAgg,
    preMatchAgg,
    offAgg,
    onItems,
    notPricedItems,
    preMatchItems,
    offItems,
  ] = await Promise.all([
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
        matchStatus: "out_of_scope",
      },
      _sum: { extendedPrice: true },
    }),
    prisma.cOGRecord.aggregate({
      where: {
        facilityId: facility.id,
        OR: scopeOR,
        matchStatus: "unknown_vendor",
      },
      _sum: { extendedPrice: true },
    }),
    prisma.cOGRecord.groupBy({
      by: ["vendorItemNo"],
      where: {
        facilityId: facility.id,
        OR: scopeOR,
        matchStatus: { in: ["on_contract", "price_variance"] },
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
        matchStatus: "out_of_scope",
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
        matchStatus: "unknown_vendor",
        vendorItemNo: { not: null },
      },
      _sum: { extendedPrice: true },
      orderBy: { _sum: { extendedPrice: "desc" } },
      take: 10,
    }),
  ])

  const toItems = (
    rows: Array<{
      vendorItemNo: string | null
      _sum: { extendedPrice: unknown } | null
    }>,
  ): OffContractSpendItem[] =>
    rows
      .filter(
        (r): r is typeof r & { vendorItemNo: string } =>
          r.vendorItemNo !== null,
      )
      .map((r) => ({
        vendorItemNo: r.vendorItemNo,
        totalSpend: Number(r._sum?.extendedPrice ?? 0),
      }))

  const topOnContract = toItems(onItems)
  const topNotPriced = toItems(notPricedItems)
  const topPreMatch = toItems(preMatchItems)
  const topOffContract = toItems(offItems)

  return serialize({
    onContract: Number(onAgg._sum?.extendedPrice ?? 0),
    notPriced: Number(notPricedAgg._sum?.extendedPrice ?? 0),
    preMatch: Number(preMatchAgg._sum?.extendedPrice ?? 0),
    offContract: Number(offAgg._sum?.extendedPrice ?? 0),
    topOnContract,
    topNotPriced,
    topPreMatch,
    topOffContract,
    // Legacy alias so older callers (and any stale cached queries) keep working.
    offContractItems: topOffContract,
  })
}
