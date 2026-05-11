"use server"

/**
 * Contract insights — live compliance / market share / price variance.
 *
 * Extracted from lib/actions/contracts.ts during subsystem F5 (tech
 * debt split). Re-exported from there for backward-compat with existing
 * import sites.
 */
import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { contractOwnershipWhere } from "@/lib/actions/contracts-auth"
import {
  calculateComplianceRate,
  calculateMarketShare,
  type CompliancePurchase,
  type ComplianceContract,
} from "@/lib/contracts/compliance"
import {
  analyzePriceDiscrepancies,
  type ContractPriceLookup,
  type InvoiceLineForVariance,
} from "@/lib/contracts/price-variance"
import { serialize } from "@/lib/serialize"

export async function getContractInsights(contractId: string) {
  const { facility } = await requireFacility()

  // Charles audit round-11 BLOCKER: scope by ownership.
  const contract = await prisma.contract.findFirstOrThrow({
    where: contractOwnershipWhere(contractId, facility.id),
    include: {
      pricingItems: true,
      purchaseOrders: {
        include: { lineItems: true },
      },
      // Bug #19 (2026-05-11, Vick): the market-share section below
      // queried `cOGRecord.aggregate` with `productCategoryId`, which
      // is NOT a column on COGRecord (COGRecord.category is a plain
      // string, not an FK). That threw `Unknown argument
      // productCategoryId` for every contract that has a primary
      // category set — including post-create redirect on the new
      // market-share contract surface, which is what produced the
      // generic "Failed to create contract" toast (the underlying
      // server-component throw got prod-redacted into a digest).
      // Load the category's name here so we can filter the COG rows
      // against `category` (string) instead.
      productCategory: { select: { name: true } },
    },
  })

  const priceMap = new Map<string, number>()
  for (const item of contract.pricingItems) {
    priceMap.set(item.vendorItemNo, Number(item.unitPrice))
  }
  const approvedItems = new Set(
    contract.pricingItems.map((p) => p.vendorItemNo),
  )
  const complianceContract: ComplianceContract = {
    id: contract.id,
    vendorId: contract.vendorId,
    effectiveDate: contract.effectiveDate,
    expirationDate: contract.expirationDate,
    approvedItems,
    priceByItem: priceMap,
  }

  const poLines = await prisma.pOLineItem.findMany({
    where: {
      purchaseOrder: {
        facilityId: facility.id,
        vendorId: contract.vendorId,
      },
    },
    include: { purchaseOrder: { select: { orderDate: true } } },
  })

  const purchases: CompliancePurchase[] = poLines.map((l) => ({
    vendorId: contract.vendorId,
    vendorItemNo: l.vendorItemNo ?? "",
    unitPrice: Number(l.unitPrice),
    purchaseDate: l.purchaseOrder?.orderDate ?? contract.effectiveDate,
  }))

  const compliance = calculateComplianceRate(
    purchases,
    [complianceContract],
    new Date(),
  )

  const invoiceLines = await prisma.invoiceLineItem.findMany({
    where: {
      vendorItemNo: { in: contract.pricingItems.map((p) => p.vendorItemNo) },
      invoice: { facilityId: facility.id, vendorId: contract.vendorId },
    },
    select: {
      id: true,
      vendorItemNo: true,
      invoicePrice: true,
      invoiceQuantity: true,
    },
  })
  const priceLookup: ContractPriceLookup = new Map()
  for (const item of contract.pricingItems) {
    priceLookup.set(`${contract.id}::${item.vendorItemNo}`, Number(item.unitPrice))
  }
  const varianceLines: InvoiceLineForVariance[] = invoiceLines
    .filter((l): l is typeof l & { vendorItemNo: string } => l.vendorItemNo != null)
    .map((l) => ({
      id: l.id,
      contractId: contract.id,
      vendorItemNo: l.vendorItemNo,
      actualPrice: Number(l.invoicePrice),
      quantity: l.invoiceQuantity,
    }))
  const priceVariance = analyzePriceDiscrepancies(varianceLines, priceLookup)

  let marketShare: ReturnType<typeof calculateMarketShare> | null = null
  const categoryName = contract.productCategory?.name ?? null
  if (categoryName) {
    const [vendorAgg, categoryAgg] = await Promise.all([
      prisma.cOGRecord.aggregate({
        where: {
          facilityId: facility.id,
          vendorId: contract.vendorId,
          category: categoryName,
        },
        _sum: { extendedPrice: true },
      }),
      prisma.cOGRecord.aggregate({
        where: {
          facilityId: facility.id,
          category: categoryName,
        },
        _sum: { extendedPrice: true },
      }),
    ])
    marketShare = calculateMarketShare(
      Number(vendorAgg._sum.extendedPrice ?? 0),
      Number(categoryAgg._sum.extendedPrice ?? 0),
      contract.marketShareCommitment != null
        ? Number(contract.marketShareCommitment)
        : null,
    )
  }

  return serialize({
    compliance,
    priceVariance: {
      totalLines: priceVariance.totalLines,
      overchargeTotal: priceVariance.overchargeTotal,
      underchargeTotal: priceVariance.underchargeTotal,
      bySeverity: priceVariance.bySeverity,
    },
    marketShare,
  })
}
