"use server"

/**
 * Compliance Rate + Current Market Share are NEVER manual inputs.
 * They're derived from live COG + ContractPricing data within the
 * contract's categories. This action returns both for either an
 * existing contract (by id) or a prospective one (by vendor +
 * facility + categories + window).
 *
 * Definitions per Charles 2026-04-26:
 *
 *   complianceRate  = COG rows on this contract's vendor + categories
 *                     where matchStatus = on_contract
 *                     ÷ COG rows on this vendor + categories total
 *
 *   currentMarketShare = vendor's spend in the contract's categories
 *                        ÷ ALL spend in those categories at the facility
 *
 * Both are scoped to the contract's effective window when present
 * (otherwise the trailing 365 days). Returns 0 when the denominator
 * is 0 — no contract can have positive compliance/share without
 * any COG to measure against.
 */

import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"

export interface ContractMetricsInput {
  /** Either an existing contractId OR the prospective shape below. */
  contractId?: string
  vendorId?: string
  productCategories?: string[]
  effectiveDate?: string | Date
  expirationDate?: string | Date
}

export interface ContractMetricsResult {
  complianceRate: number | null
  currentMarketShare: number | null
  /** Diagnostics so the form can show "computed from N rows over period X". */
  cogRowsTotal: number
  cogRowsOnContract: number
  vendorSpendInCategories: number
  totalSpendInCategories: number
  windowStart: string
  windowEnd: string
}

export async function computeContractMetrics(
  input: ContractMetricsInput,
): Promise<ContractMetricsResult> {
  const { facility } = await requireFacility()

  let vendorId = input.vendorId
  let categories = input.productCategories ?? []
  let windowStart: Date
  let windowEnd: Date

  if (input.contractId) {
    const contract = await prisma.contract.findFirstOrThrow({
      where: { id: input.contractId, facilityId: facility.id },
      select: {
        vendorId: true,
        effectiveDate: true,
        expirationDate: true,
        productCategory: { select: { name: true } },
        terms: { select: { categories: true, appliesTo: true } },
      },
    })
    vendorId = contract.vendorId
    // Union: explicit productCategory + every term.categories array.
    const cats = new Set<string>()
    if (contract.productCategory?.name) cats.add(contract.productCategory.name)
    for (const t of contract.terms) {
      for (const c of t.categories) cats.add(c)
    }
    categories = Array.from(cats)
    windowStart = contract.effectiveDate
    windowEnd = contract.expirationDate
  } else {
    if (!vendorId) {
      throw new Error("vendorId is required when contractId is not provided")
    }
    windowStart = input.effectiveDate
      ? new Date(input.effectiveDate)
      : new Date(Date.now() - 365 * 24 * 60 * 60 * 1000)
    windowEnd = input.expirationDate
      ? new Date(input.expirationDate)
      : new Date()
  }

  // Cap window end at "today" — future dates have no COG yet.
  const today = new Date()
  if (windowEnd > today) windowEnd = today

  // Cap window start at 5 years back — older COG isn't relevant + slows query.
  const fiveYearsAgo = new Date(today)
  fiveYearsAgo.setFullYear(fiveYearsAgo.getFullYear() - 5)
  if (windowStart < fiveYearsAgo) windowStart = fiveYearsAgo

  const baseWhere = {
    facilityId: facility.id,
    transactionDate: { gte: windowStart, lte: windowEnd },
  }
  // Category filter — empty list means "no scope", which yields 0
  // rows → both metrics return null (we don't want to claim 100%
  // compliance against an empty universe).
  const categoryClause =
    categories.length > 0
      ? { category: { in: categories } }
      : null

  if (!vendorId || !categoryClause) {
    return {
      complianceRate: null,
      currentMarketShare: null,
      cogRowsTotal: 0,
      cogRowsOnContract: 0,
      vendorSpendInCategories: 0,
      totalSpendInCategories: 0,
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
    }
  }

  // Compliance: vendor + category rows where matchStatus = on_contract
  // ÷ vendor + category rows total.
  const [
    cogRowsTotal,
    cogRowsOnContract,
    vendorSpendAgg,
    totalSpendAgg,
  ] = await Promise.all([
    prisma.cOGRecord.count({
      where: { ...baseWhere, ...categoryClause, vendorId },
    }),
    prisma.cOGRecord.count({
      where: {
        ...baseWhere,
        ...categoryClause,
        vendorId,
        matchStatus: "on_contract",
      },
    }),
    prisma.cOGRecord.aggregate({
      where: { ...baseWhere, ...categoryClause, vendorId },
      _sum: { extendedPrice: true },
    }),
    prisma.cOGRecord.aggregate({
      where: { ...baseWhere, ...categoryClause },
      _sum: { extendedPrice: true },
    }),
  ])

  const vendorSpendInCategories = Number(vendorSpendAgg._sum.extendedPrice ?? 0)
  const totalSpendInCategories = Number(totalSpendAgg._sum.extendedPrice ?? 0)

  const complianceRate =
    cogRowsTotal > 0
      ? Math.round((cogRowsOnContract / cogRowsTotal) * 1000) / 10
      : null

  const currentMarketShare =
    totalSpendInCategories > 0
      ? Math.round(
          (vendorSpendInCategories / totalSpendInCategories) * 1000,
        ) / 10
      : null

  return {
    complianceRate,
    currentMarketShare,
    cogRowsTotal,
    cogRowsOnContract,
    vendorSpendInCategories,
    totalSpendInCategories,
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
  }
}
