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

  const contract = await prisma.contract.findUniqueOrThrow({
    where: { id: contractId },
    include: {
      pricingItems: true,
      purchaseOrders: {
        include: { lineItems: true },
      },
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
  if (contract.productCategoryId) {
    const [vendorAgg, categoryAgg] = await Promise.all([
      prisma.cOGRecord.aggregate({
        where: {
          facilityId: facility.id,
          vendorId: contract.vendorId,
          productCategoryId: contract.productCategoryId,
        },
        _sum: { extendedPrice: true },
      }),
      prisma.cOGRecord.aggregate({
        where: {
          facilityId: facility.id,
          productCategoryId: contract.productCategoryId,
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
