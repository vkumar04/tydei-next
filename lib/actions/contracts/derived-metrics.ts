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
import { computeCategoryMarketShare } from "@/lib/contracts/market-share-filter"

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

  // Compliance still runs as a direct row-count ratio (matchStatus is
  // not a market-share concept). Market share goes through the
  // canonical `computeCategoryMarketShare` helper so the
  // `effectiveCategoryOf` fallback (COG.category=null + matched
  // contract's productCategory) feeds both numerator AND denominator.
  // Bug 2026-05-18 (Vick): the prior direct aggregate skipped that
  // fallback entirely, undercounting spend for any contract whose COG
  // rows arrived without explicit categories — even though the
  // per-category card on the contract detail (`CategoryMarketShareCard`)
  // already counts that spend via the same helper.
  const [
    cogRowsTotal,
    cogRowsOnContract,
    cogRowsForMarketShare,
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
    // Wider net for market share: pull every COG row in the window
    // (vendor's + competitors'), pass through the canonical filter, and
    // then sum across our category scope. We can't pre-filter by
    // `category: { in: categories }` here because the fallback path
    // depends on having `contractId` available so the helper can
    // resolve null categories.
    prisma.cOGRecord.findMany({
      where: baseWhere,
      select: {
        vendorId: true,
        category: true,
        extendedPrice: true,
        contractId: true,
      },
    }),
  ])

  // Build the contract-category fallback map ONCE for all matched
  // contracts in the window (not just the one being evaluated). This
  // mirrors the per-category card's query shape.
  const contractIdsInWindow = Array.from(
    new Set(
      cogRowsForMarketShare
        .map((r) => r.contractId)
        .filter((v): v is string => !!v),
    ),
  )
  const contractCategoryRows =
    contractIdsInWindow.length > 0
      ? await prisma.contract.findMany({
          where: { id: { in: contractIdsInWindow } },
          select: {
            id: true,
            productCategory: { select: { name: true } },
          },
        })
      : []
  const contractCategoryMap = new Map<string, string | null>(
    contractCategoryRows.map((c) => [c.id, c.productCategory?.name ?? null]),
  )

  const msComputed = computeCategoryMarketShare({
    rows: cogRowsForMarketShare,
    contractCategoryMap,
    vendorId,
  })

  // Sum vendor + total spend across only this contract's category
  // scope. Rows for categories outside scope are ignored. Rows the
  // helper couldn't categorize (no COG.category + no contract
  // fallback) live in `msComputed.uncategorizedSpend` and don't count
  // toward share — they're a real data-quality gap, not market share.
  const scopeSet = new Set(categories)
  let vendorSpendInCategories = 0
  let totalSpendInCategories = 0
  for (const row of msComputed.rows) {
    if (!scopeSet.has(row.category)) continue
    vendorSpendInCategories += row.vendorSpend
    totalSpendInCategories += row.categoryTotal
  }

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
