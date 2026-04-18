"use server"

import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { computeRebateFromPrismaTiers } from "@/lib/rebates/calculate"
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
import {
  buildMonthlyAccruals,
  type MonthlySpend,
} from "@/lib/contracts/accrual"
import {
  allocateRebatesToProcedures,
  calculateMargins,
  type ProcedureSpend,
} from "@/lib/contracts/true-margin"
import {
  evaluateAllOrNothing,
  evaluateProportional,
  type TieInMember,
  type MemberPerformance,
} from "@/lib/contracts/tie-in"
import type { TierLike, RebateMethodName } from "@/lib/contracts/rebate-method"
import {
  contractFiltersSchema,
  createContractSchema,
  updateContractSchema,
  type ContractFilters,
  type CreateContractInput,
  type UpdateContractInput,
} from "@/lib/validators/contracts"
import type { Prisma } from "@prisma/client"
import { serialize } from "@/lib/serialize"
import { logAudit } from "@/lib/audit"
import { revalidatePath } from "next/cache"
import { recomputeMatchStatusesForVendor } from "@/lib/cog/recompute"

// ─── List Contracts ──────────────────────────────────────────────

export async function getContracts(input: ContractFilters) {
  const { facility } = await requireFacility()
  const filters = contractFiltersSchema.parse(input)

  const conditions: Prisma.ContractWhereInput[] = [
    {
      OR: [
        { facilityId: facility.id },
        { contractFacilities: { some: { facilityId: facility.id } } },
      ],
    },
  ]

  if (filters.status) conditions.push({ status: filters.status })
  if (filters.type) conditions.push({ contractType: filters.type })
  if (filters.search) {
    conditions.push({
      OR: [
        { name: { contains: filters.search, mode: "insensitive" } },
        { vendor: { name: { contains: filters.search, mode: "insensitive" } } },
        { contractNumber: { contains: filters.search, mode: "insensitive" } },
      ],
    })
  }

  const where: Prisma.ContractWhereInput = { AND: conditions }

  const [contracts, total] = await Promise.all([
    prisma.contract.findMany({
      where,
      include: {
        vendor: { select: { id: true, name: true, logoUrl: true } },
        productCategory: { select: { id: true, name: true } },
        facility: { select: { id: true, name: true } },
        rebates: { select: { rebateEarned: true, rebateCollected: true } },
      },
      orderBy: { updatedAt: "desc" },
      skip: ((filters.page ?? 1) - 1) * (filters.pageSize ?? 20),
      take: filters.pageSize ?? 20,
    }),
    prisma.contract.count({ where }),
  ])

  // Derive aggregated rebateEarned / rebateCollected per contract so UI can
  // render the "Rebate Earned" column without an extra round-trip.
  const withDerived = contracts.map((c) => {
    const rebateEarned = (c.rebates ?? []).reduce(
      (sum, r) => sum + Number(r.rebateEarned ?? 0),
      0,
    )
    const rebateCollected = (c.rebates ?? []).reduce(
      (sum, r) => sum + Number(r.rebateCollected ?? 0),
      0,
    )
    return { ...c, rebateEarned, rebateCollected }
  })

  return serialize({ contracts: withDerived, total })
}

// ─── Single Contract ─────────────────────────────────────────────

export async function getContract(id: string) {
  const { facility } = await requireFacility()

  const contract = await prisma.contract.findUniqueOrThrow({
    where: {
      id,
      OR: [
        { facilityId: facility.id },
        { contractFacilities: { some: { facilityId: facility.id } } },
      ],
    },
    include: {
      vendor: { select: { id: true, name: true, logoUrl: true, contactName: true, contactEmail: true } },
      productCategory: { select: { id: true, name: true } },
      terms: {
        include: { tiers: { orderBy: { tierNumber: "asc" } } },
        orderBy: { createdAt: "asc" },
      },
      documents: { orderBy: { uploadDate: "desc" } },
      contractFacilities: {
        include: { facility: { select: { id: true, name: true } } },
      },
      contractCategories: {
        select: {
          productCategoryId: true,
          productCategory: { select: { id: true, name: true } },
        },
      },
      rebates: {
        select: { id: true, rebateEarned: true, rebateCollected: true },
      },
      createdBy: { select: { id: true, name: true } },
    },
  })

  // Derive aggregates from the rebates relation
  let rebateEarned = contract.rebates.reduce(
    (sum, r) => sum + Number(r.rebateEarned ?? 0),
    0
  )
  let rebateCollected = contract.rebates.reduce(
    (sum, r) => sum + Number(r.rebateCollected ?? 0),
    0
  )

  // Always aggregate current COG spend against this contract's vendor —
  // we need it for tier-progress surfaces even when persisted rebate
  // rows already exist. When persisted rebate rows are zero but there's
  // matching spend, we also recompute earned/collected from the tiers
  // below.
  const cogAgg = await prisma.cOGRecord.aggregate({
    where: {
      facilityId: facility.id,
      vendorId: contract.vendorId,
    },
    _sum: { extendedPrice: true },
  })
  const currentSpend = Number(cogAgg._sum.extendedPrice ?? 0)

  // Dynamic fallback: if no persisted rebate rows exist but the contract
  // has tiers and matching COG spend, compute rebates from live data
  // using the shared rebate calculator.
  if (rebateEarned === 0 && contract.terms.length > 0) {
    const firstTerm = contract.terms[0]
    const tiers = firstTerm?.tiers ?? []
    if (tiers.length > 0 && currentSpend > 0) {
      const result = computeRebateFromPrismaTiers(currentSpend, tiers, {
        method: firstTerm?.rebateMethod ?? "cumulative",
      })
      rebateEarned = result.rebateEarned
      rebateCollected = result.rebateCollected
    }
  }

  return serialize({ ...contract, rebateEarned, rebateCollected, currentSpend })
}

// ─── Contract Stats ──────────────────────────────────────────────

export async function getContractStats() {
  const { facility } = await requireFacility()

  const where: Prisma.ContractWhereInput = {
    OR: [
      { facilityId: facility.id },
      { contractFacilities: { some: { facilityId: facility.id } } },
    ],
  }

  const [totalContracts, aggregates] = await Promise.all([
    prisma.contract.count({ where }),
    prisma.contract.aggregate({
      where,
      _sum: { totalValue: true, annualValue: true },
    }),
  ])

  const rebateResult = await prisma.rebate.aggregate({
    where: { facilityId: facility.id },
    _sum: { rebateEarned: true },
  })

  return serialize({
    totalContracts,
    totalValue: Number(aggregates._sum.totalValue ?? 0),
    totalRebates: Number(rebateResult._sum?.rebateEarned ?? 0),
  })
}

// ─── Create Contract ─────────────────────────────────────────────

export async function createContract(input: CreateContractInput) {
  const session = await requireFacility()
  const data = createContractSchema.parse(input)

  const contract = await prisma.contract.create({
    data: {
      name: data.name,
      contractNumber: data.contractNumber,
      vendorId: data.vendorId,
      facilityId: session.facility.id,
      productCategoryId: data.productCategoryId,
      contractType: data.contractType,
      status: data.status,
      effectiveDate: new Date(data.effectiveDate),
      expirationDate: new Date(data.expirationDate),
      autoRenewal: data.autoRenewal,
      terminationNoticeDays: data.terminationNoticeDays,
      totalValue: data.totalValue,
      annualValue: data.annualValue,
      description: data.description,
      notes: data.notes,
      gpoAffiliation: data.gpoAffiliation,
      performancePeriod: data.performancePeriod,
      rebatePayPeriod: data.rebatePayPeriod,
      isMultiFacility: data.isMultiFacility,
      createdById: session.user.id,
      ...(data.facilityIds.length > 0 && {
        isMultiFacility: true,
        contractFacilities: {
          create: data.facilityIds.map((fId) => ({ facilityId: fId })),
        },
      }),
      ...(data.categoryIds.length > 0 && {
        contractCategories: {
          create: data.categoryIds.map((cId) => ({ productCategoryId: cId })),
        },
      }),
    },
  })

  await logAudit({
    userId: session.user.id,
    action: "contract.created",
    entityType: "contract",
    entityId: contract.id,
    metadata: { name: data.name, vendorId: data.vendorId },
  })

  // Recompute COG match-statuses for this vendor so rows flip to
  // on_contract / price_variance / out_of_scope as appropriate.
  // Scope tight: only the affected vendor at this facility.
  await recomputeMatchStatusesForVendor(prisma, {
    vendorId: data.vendorId,
    facilityId: session.facility.id,
  })
  revalidatePath("/dashboard/cog")
  revalidatePath("/dashboard/contracts")
  revalidatePath("/dashboard")

  return serialize(contract)
}

// ─── Update Contract ─────────────────────────────────────────────

export async function updateContract(id: string, input: UpdateContractInput) {
  const session = await requireFacility()
  const { facility } = session
  const data = updateContractSchema.parse(input)

  // Verify ownership before updating
  await prisma.contract.findUniqueOrThrow({
    where: {
      id,
      OR: [
        { facilityId: facility.id },
        { contractFacilities: { some: { facilityId: facility.id } } },
      ],
    },
    select: { id: true },
  })

  const updateData: Prisma.ContractUpdateInput = {}

  if (data.name !== undefined) updateData.name = data.name
  if (data.contractNumber !== undefined) updateData.contractNumber = data.contractNumber
  if (data.vendorId !== undefined) updateData.vendor = { connect: { id: data.vendorId } }
  if (data.productCategoryId !== undefined) updateData.productCategory = { connect: { id: data.productCategoryId } }
  if (data.contractType !== undefined) updateData.contractType = data.contractType
  if (data.status !== undefined) updateData.status = data.status
  if (data.effectiveDate !== undefined) updateData.effectiveDate = new Date(data.effectiveDate)
  if (data.expirationDate !== undefined) updateData.expirationDate = new Date(data.expirationDate)
  if (data.autoRenewal !== undefined) updateData.autoRenewal = data.autoRenewal
  if (data.terminationNoticeDays !== undefined) updateData.terminationNoticeDays = data.terminationNoticeDays
  if (data.totalValue !== undefined) updateData.totalValue = data.totalValue
  if (data.annualValue !== undefined) updateData.annualValue = data.annualValue
  if (data.description !== undefined) updateData.description = data.description
  if (data.notes !== undefined) updateData.notes = data.notes
  if (data.gpoAffiliation !== undefined) updateData.gpoAffiliation = data.gpoAffiliation
  if (data.performancePeriod !== undefined) updateData.performancePeriod = data.performancePeriod
  if (data.rebatePayPeriod !== undefined) updateData.rebatePayPeriod = data.rebatePayPeriod
  if (data.isMultiFacility !== undefined) updateData.isMultiFacility = data.isMultiFacility

  if (data.facilityIds !== undefined) {
    await prisma.contractFacility.deleteMany({ where: { contractId: id } })
    if (data.facilityIds.length > 0) {
      updateData.isMultiFacility = true
      await prisma.contractFacility.createMany({
        data: data.facilityIds.map((fId) => ({ contractId: id, facilityId: fId })),
      })
    }
  }

  if (data.categoryIds !== undefined) {
    await prisma.contractProductCategory.deleteMany({ where: { contractId: id } })
    if (data.categoryIds.length > 0) {
      updateData.productCategory = { connect: { id: data.categoryIds[0] } }
      await prisma.contractProductCategory.createMany({
        data: data.categoryIds.map((cId) => ({ contractId: id, productCategoryId: cId })),
      })
    }
  }

  const contract = await prisma.contract.update({
    where: { id },
    data: updateData,
  })

  await logAudit({
    userId: session.user.id,
    action: "contract.updated",
    entityType: "contract",
    entityId: id,
    metadata: { updatedFields: Object.keys(updateData) },
  })

  // Recompute COG match-statuses for this contract's vendor. If the vendor
  // changed, recompute for both the old and new vendor so COG rows flip
  // off the old contract and onto (or off of) the new one.
  const vendorsToRecompute = new Set<string>()
  vendorsToRecompute.add(contract.vendorId)
  if (data.vendorId !== undefined && data.vendorId !== contract.vendorId) {
    vendorsToRecompute.add(data.vendorId)
  }
  for (const vendorId of vendorsToRecompute) {
    await recomputeMatchStatusesForVendor(prisma, {
      vendorId,
      facilityId: facility.id,
    })
  }
  revalidatePath("/dashboard/cog")
  revalidatePath("/dashboard/contracts")
  revalidatePath(`/dashboard/contracts/${id}`)
  revalidatePath("/dashboard")

  return serialize(contract)
}

// ─── Create Contract Document ───────────────────────────────────

export async function createContractDocument(input: {
  contractId: string
  name: string
  type?: string
  url?: string
}) {
  await requireFacility()
  return prisma.contractDocument.create({
    data: {
      contractId: input.contractId,
      name: input.name,
      type: (input.type as any) ?? "main",
      url: input.url,
    },
  })
}

// ─── Delete Contract Document ───────────────────────────────────

export async function deleteContractDocument(id: string) {
  const session = await requireFacility()
  const { facility } = session

  // Verify the document belongs to a contract owned by this facility
  const doc = await prisma.contractDocument.findUniqueOrThrow({
    where: { id },
    select: {
      id: true,
      contractId: true,
      contract: {
        select: {
          facilityId: true,
          contractFacilities: { select: { facilityId: true } },
        },
      },
    },
  })
  const owned =
    doc.contract.facilityId === facility.id ||
    doc.contract.contractFacilities.some((cf) => cf.facilityId === facility.id)
  if (!owned) {
    throw new Error("Not authorized to delete this document")
  }

  await prisma.contractDocument.delete({ where: { id } })

  await logAudit({
    userId: session.user.id,
    action: "contract_document.deleted",
    entityType: "contractDocument",
    entityId: id,
    metadata: { contractId: doc.contractId },
  })
}

// ─── Delete Contract ─────────────────────────────────────────────

export async function deleteContract(id: string) {
  const session = await requireFacility()
  const { facility } = session

  // Verify ownership + capture vendorId before deleting so we can
  // recompute COG match-statuses after.
  const existing = await prisma.contract.findUniqueOrThrow({
    where: {
      id,
      OR: [
        { facilityId: facility.id },
        { contractFacilities: { some: { facilityId: facility.id } } },
      ],
    },
    select: { id: true, vendorId: true },
  })

  await prisma.contract.delete({ where: { id } })

  await logAudit({
    userId: session.user.id,
    action: "contract.deleted",
    entityType: "contract",
    entityId: id,
  })

  // Recompute: rows that were on this contract flip to
  // off_contract_item / out_of_scope depending on remaining contracts.
  await recomputeMatchStatusesForVendor(prisma, {
    vendorId: existing.vendorId,
    facilityId: facility.id,
  })
  revalidatePath("/dashboard/cog")
  revalidatePath("/dashboard/contracts")
  revalidatePath("/dashboard")
}

// ─── Contract Insights (compliance, market share, price variance) ───
//
// Live-computes the subsystem 4 / 5 engines against the facility's
// purchase-order + invoice history for one contract. Returns a summary
// struct the detail page renders as cards.

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

  // Build the ComplianceContract from current contract pricing.
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

  // Pull purchases from PurchaseOrder.lineItems for the facility + vendor.
  // Fall back to COG records where PO history is thin.
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

  // Price variance: only lines with a contractPrice set on InvoiceLineItem
  // get a variance today. For a live read we re-compute from
  // InvoiceLineItem where the contract's pricingItems have a matching SKU.
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

  // Market share: vendor spend over product-category total.
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

// ─── Accrual Timeline (monthly) ─────────────────────────────────────
//
// Builds a month-by-month accrual timeline for one contract using
// COG records as the spend source and the subsystem-3 accrual engine.
// Returns one row per month from contract effectiveDate through
// min(today, expirationDate).

export async function getAccrualTimeline(contractId: string) {
  const { facility } = await requireFacility()

  const contract = await prisma.contract.findUniqueOrThrow({
    where: { id: contractId },
    include: {
      terms: {
        include: { tiers: { orderBy: { tierNumber: "asc" } } },
        orderBy: { createdAt: "asc" },
      },
    },
  })

  const term = contract.terms[0]
  if (!term || term.tiers.length === 0) {
    return serialize({ rows: [], method: "cumulative" as RebateMethodName })
  }

  const tiers: TierLike[] = term.tiers.map((t) => ({
    tierNumber: t.tierNumber,
    tierName: t.tierName ?? null,
    spendMin: Number(t.spendMin),
    spendMax: t.spendMax ? Number(t.spendMax) : null,
    rebateValue: Number(t.rebateValue),
  }))
  const method: RebateMethodName = term.rebateMethod ?? "cumulative"

  // Group COG records by YYYY-MM within the contract's effective window.
  const end = new Date(
    Math.min(new Date().getTime(), contract.expirationDate.getTime()),
  )
  const cogRecords = await prisma.cOGRecord.findMany({
    where: {
      facilityId: facility.id,
      vendorId: contract.vendorId,
      createdAt: {
        gte: contract.effectiveDate,
        lte: end,
      },
    },
    select: { createdAt: true, extendedPrice: true },
  })

  const byMonth = new Map<string, number>()
  for (const r of cogRecords) {
    const d = r.createdAt
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`
    byMonth.set(key, (byMonth.get(key) ?? 0) + Number(r.extendedPrice))
  }

  // Produce a complete month-by-month series (fill missing months with 0)
  // so the timeline is continuous.
  const series: MonthlySpend[] = []
  const cursor = new Date(
    Date.UTC(
      contract.effectiveDate.getUTCFullYear(),
      contract.effectiveDate.getUTCMonth(),
      1,
    ),
  )
  const lastMonth = new Date(
    Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1),
  )
  while (cursor <= lastMonth) {
    const key = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}`
    series.push({ month: key, spend: byMonth.get(key) ?? 0 })
    cursor.setUTCMonth(cursor.getUTCMonth() + 1)
  }

  const rows = buildMonthlyAccruals(series, tiers, method)
  return serialize({ rows, method })
}

// ─── True Margin Analysis ────────────────────────────────────────────
//
// Groups cases by primary CPT and attributes rebate dollars in
// proportion to the supply spend each procedure pulls from this
// contract. Returns the top procedures sorted by vendor spend.

export async function getContractMarginAnalysis(contractId: string) {
  const { facility } = await requireFacility()

  const contract = await prisma.contract.findUniqueOrThrow({
    where: { id: contractId },
    include: {
      terms: {
        include: { tiers: { orderBy: { tierNumber: "asc" } } },
        orderBy: { createdAt: "asc" },
      },
      rebates: { select: { rebateEarned: true } },
    },
  })

  // Pull case supplies that are linked to this contract.
  const supplies = await prisma.caseSupply.findMany({
    where: {
      contractId,
      caseRecord: { facilityId: facility.id },
    },
    include: {
      caseRecord: {
        select: {
          id: true,
          primaryCptCode: true,
          totalSpend: true,
          totalReimbursement: true,
        },
      },
    },
  })

  if (supplies.length === 0) {
    return serialize({ procedures: [], totalVendorSpend: 0, totalRebate: 0 })
  }

  // Group by CPT. Aggregate vendor spend, case-level revenue, case-level costs.
  // Use case.totalSpend for costs (not just supply cost) and case.totalReimbursement
  // for revenue so margins reflect the full case P&L with supply-level rebate
  // attribution.
  interface ProcedureAgg {
    vendorSpend: number
    caseIds: Set<string>
    revenue: number
    costs: number
  }
  const byProcedure = new Map<string, ProcedureAgg>()

  for (const s of supplies) {
    const cpt = s.caseRecord?.primaryCptCode
    if (!cpt) continue
    const entry = byProcedure.get(cpt) ?? {
      vendorSpend: 0,
      caseIds: new Set<string>(),
      revenue: 0,
      costs: 0,
    }
    entry.vendorSpend += Number(s.extendedCost)
    if (s.caseRecord && !entry.caseIds.has(s.caseRecord.id)) {
      entry.caseIds.add(s.caseRecord.id)
      entry.revenue += Number(s.caseRecord.totalReimbursement)
      entry.costs += Number(s.caseRecord.totalSpend)
    }
    byProcedure.set(cpt, entry)
  }

  const procedureSpends: ProcedureSpend[] = Array.from(byProcedure.entries()).map(
    ([cpt, agg]) => ({ procedureId: cpt, vendorSpend: agg.vendorSpend }),
  )
  const totalVendorSpend = procedureSpends.reduce(
    (s, p) => s + p.vendorSpend,
    0,
  )

  // Use persisted earned rebates if any, else compute from current spend.
  let totalRebate = contract.rebates.reduce(
    (s, r) => s + Number(r.rebateEarned),
    0,
  )
  if (totalRebate === 0 && contract.terms[0]?.tiers.length) {
    const firstTerm = contract.terms[0]
    const cogAgg = await prisma.cOGRecord.aggregate({
      where: { facilityId: facility.id, vendorId: contract.vendorId },
      _sum: { extendedPrice: true },
    })
    const vendorCog = Number(cogAgg._sum.extendedPrice ?? 0)
    if (vendorCog > 0) {
      totalRebate = computeRebateFromPrismaTiers(vendorCog, firstTerm.tiers, {
        method: firstTerm.rebateMethod ?? "cumulative",
      }).rebateEarned
    }
  }

  const allocations = allocateRebatesToProcedures(
    procedureSpends,
    totalVendorSpend,
    totalRebate,
  )

  const procedures = Array.from(byProcedure.entries())
    .map(([cpt, agg]) => {
      const allocation = allocations.get(cpt) ?? 0
      const margins = calculateMargins(
        { revenue: agg.revenue, costs: agg.costs },
        allocation,
      )
      return {
        cptCode: cpt,
        vendorSpend: agg.vendorSpend,
        caseCount: agg.caseIds.size,
        revenue: agg.revenue,
        costs: agg.costs,
        rebateAllocation: allocation,
        standardMargin: margins.standardMargin,
        trueMargin: margins.trueMargin,
        standardMarginPercent: margins.standardMarginPercent,
        trueMarginPercent: margins.trueMarginPercent,
      }
    })
    .sort((a, b) => b.vendorSpend - a.vendorSpend)

  return serialize({
    procedures,
    totalVendorSpend,
    totalRebate,
  })
}

// ─── Tie-In Bundle ──────────────────────────────────────────────────
//
// Reads a bundle (if this contract is the primary), loads each member's
// current spend + rebate, runs the appropriate compliance engine, and
// returns a struct for the detail page.

export async function getContractTieInBundle(contractId: string) {
  const { facility } = await requireFacility()

  const bundle = await prisma.tieInBundle.findUnique({
    where: { primaryContractId: contractId },
    include: {
      primaryContract: { select: { id: true, name: true, vendorId: true } },
      members: {
        include: {
          contract: {
            include: {
              vendor: { select: { id: true, name: true } },
              terms: {
                include: { tiers: { orderBy: { tierNumber: "asc" } } },
                take: 1,
                orderBy: { createdAt: "asc" },
              },
            },
          },
        },
      },
    },
  })

  if (!bundle) {
    return serialize({ bundle: null })
  }

  // Load each member's current COG spend for the facility/vendor.
  const perf: MemberPerformance[] = []
  for (const m of bundle.members) {
    const cogAgg = await prisma.cOGRecord.aggregate({
      where: {
        facilityId: facility.id,
        vendorId: m.contract.vendorId,
      },
      _sum: { extendedPrice: true },
    })
    const spend = Number(cogAgg._sum.extendedPrice ?? 0)
    let rebate = 0
    const term = m.contract.terms[0]
    if (term && term.tiers.length > 0 && spend > 0) {
      rebate = computeRebateFromPrismaTiers(spend, term.tiers, {
        method: term.rebateMethod ?? "cumulative",
      }).rebateEarned
    }
    perf.push({
      contractId: m.contractId,
      currentSpend: spend,
      currentRebate: rebate,
    })
  }

  const members: TieInMember[] = bundle.members.map((m) => ({
    contractId: m.contractId,
    weightPercent: Number(m.weightPercent),
    minimumSpend: m.minimumSpend != null ? Number(m.minimumSpend) : null,
  }))

  const bonusMultiplier =
    bundle.bonusMultiplier != null ? Number(bundle.bonusMultiplier) : undefined

  const evaluation =
    bundle.complianceMode === "proportional"
      ? evaluateProportional(members, perf)
      : evaluateAllOrNothing(members, perf, { bonusMultiplier })

  // Enrich member rows with display fields.
  const memberRows = bundle.members.map((m) => {
    const p = perf.find((p) => p.contractId === m.contractId)
    return {
      contractId: m.contractId,
      contractName: m.contract.name,
      vendorName: m.contract.vendor.name,
      weightPercent: Number(m.weightPercent),
      minimumSpend: m.minimumSpend != null ? Number(m.minimumSpend) : null,
      currentSpend: p?.currentSpend ?? 0,
      currentRebate: p?.currentRebate ?? 0,
      compliantSoFar:
        m.minimumSpend == null
          ? true
          : (p?.currentSpend ?? 0) >= Number(m.minimumSpend),
    }
  })

  return serialize({
    bundle: {
      id: bundle.id,
      complianceMode: bundle.complianceMode,
      bonusMultiplier: bundle.bonusMultiplier != null ? Number(bundle.bonusMultiplier) : null,
      members: memberRows,
      evaluation,
    },
  })
}
