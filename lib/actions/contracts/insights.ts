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
import { canonicalizeCategoryName } from "@/lib/contracts/category-canonical"

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
      // Bug 2026-05-20 (Vick): the Performance tab Market Share card
      // showed 0.0% because the query below only narrowed to the single
      // primary `productCategory`. Contracts now carry the full multi-
      // category list via `contractCategories`; include it so we can
      // aggregate across every category the contract actually covers.
      contractCategories: {
        include: { productCategory: { select: { name: true } } },
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
  // Pull every category the contract scopes — primary + join table —
  // and de-duplicate. The Performance tab card aggregates vendor /
  // facility spend across the union.
  const contractCategoryNames = Array.from(
    new Set(
      [
        contract.productCategory?.name ?? null,
        ...contract.contractCategories.map((cc) => cc.productCategory.name),
      ].filter((n): n is string => !!n),
    ),
  )
  // Bug 2026-05-20 (Vick "Ortho Joint ↔ Joint Ortho"): the COG.category
  // string is free-form and drifts across imports. Expand the contract's
  // category list to include every stored COG category whose canonical
  // form matches one of ours, so token-shuffled aliases still aggregate.
  const wantedCanonical = new Set(
    contractCategoryNames.map(canonicalizeCategoryName).filter(Boolean),
  )
  const distinctCogCategories = wantedCanonical.size > 0
    ? await prisma.cOGRecord.findMany({
        where: {
          facilityId: facility.id,
          category: { not: null },
        },
        distinct: ["category"],
        select: { category: true },
      })
    : []
  const categoryNames = Array.from(
    new Set([
      ...contractCategoryNames,
      ...distinctCogCategories
        .map((r) => r.category)
        .filter((c): c is string => !!c)
        .filter((c) => wantedCanonical.has(canonicalizeCategoryName(c))),
    ]),
  )
  if (categoryNames.length > 0) {
    const [vendorAgg, categoryAgg] = await Promise.all([
      prisma.cOGRecord.aggregate({
        where: {
          facilityId: facility.id,
          vendorId: contract.vendorId,
          category: { in: categoryNames },
        },
        _sum: { extendedPrice: true },
      }),
      prisma.cOGRecord.aggregate({
        where: {
          facilityId: facility.id,
          category: { in: categoryNames },
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
