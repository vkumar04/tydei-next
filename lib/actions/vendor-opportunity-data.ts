"use server"

/**
 * Vendor Opportunity Engine — real DB seed.
 *
 * Derives the deal-scenario starting point from the vendor's own data:
 *   - currentAsp / currentRevenue  → the vendor's trailing-12mo COG sales
 *     (rows in facility COGRecord attributed to this vendor)
 *   - addressableSpend             → total facility spend in the categories
 *     the vendor competes in, across the facilities it sells to
 *   - currentShare                 → currentRevenue ÷ addressableSpend
 *
 * Categories are matched canonically (CLAUDE.md invariant). When the vendor
 * has no sales yet, the caller falls back to the engine defaults.
 */

import { requireVendor } from "@/lib/actions/auth"
import { prisma } from "@/lib/db"
import { serialize } from "@/lib/serialize"
import { canonicalizeCategoryName } from "@/lib/contracts/category-canonical"
import { getTrailing12MonthWindow } from "@/lib/dates/trailing-window"
import { contractsOwnedByVendor } from "@/lib/actions/contracts-vendor-auth"
import { clamp01 } from "@/lib/math/clamp"

// The ContractType enum has 6 members — used to scale multi-BU penetration.
const CONTRACT_TYPE_UNIVERSE = 6

export interface VendorOpportunityData {
  currentAsp: number
  currentRevenue: number
  addressableSpend: number
  /** 0–1. */
  currentShare: number
  // ── Real strategic signals (replace the previously-hardcoded score inputs).
  /** Top competing vendor by spend in the vendor's categories, or null. */
  competitiveThreat: string | null
  /** That competitor's share of the addressable market, 0–1 (incumbent strength). */
  topCompetitorSharePct: number
  /** Vendor's trailing-12mo earned rebates ÷ revenue, 0–1 (rebate cost). */
  rebateCostPct: number
  /** Distinct active ContractType the vendor holds (0–6) — multi-BU breadth. */
  contractTypeCount: number
  /** Whether the vendor holds a capital/tie_in contract (equipment/tech presence). */
  hasCapitalContract: boolean
  hasData: boolean
}

export async function getVendorOpportunityData(): Promise<VendorOpportunityData> {
  const { vendor } = await requireVendor()

  const { start: windowStart, end: windowEnd } = getTrailing12MonthWindow()

  // The vendor's own sales (trailing 12mo) across every facility, plus the
  // contract mix + earned rebates that drive the real strategic-score inputs.
  const [vendorRows, vendorContracts, vendorRebates] = await Promise.all([
    prisma.cOGRecord.findMany({
      where: { vendorId: vendor.id, transactionDate: { gte: windowStart, lte: windowEnd } },
      select: {
        extendedPrice: true,
        quantity: true,
        category: true,
        facilityId: true,
      },
    }),
    prisma.contract.findMany({
      where: {
        ...contractsOwnedByVendor(vendor.id),
        status: { in: ["active", "expiring"] },
      },
      select: { contractType: true },
    }),
    prisma.rebate.findMany({
      where: {
        contract: contractsOwnedByVendor(vendor.id),
        payPeriodEnd: { gte: windowStart, lte: windowEnd },
      },
      select: { rebateEarned: true },
    }),
  ])

  let currentRevenue = 0
  let vendorQty = 0
  const canonicalCats = new Set<string>()
  const facilityIds = new Set<string>()
  for (const r of vendorRows) {
    currentRevenue += Number(r.extendedPrice ?? 0)
    vendorQty += r.quantity ?? 0
    if (r.category) canonicalCats.add(canonicalizeCategoryName(r.category))
    facilityIds.add(r.facilityId)
  }

  // Total facility spend in those categories + facilities = addressable market.
  // Also aggregate spend by the OTHER vendors competing in those categories so
  // we can name the real top competitor + their share (incumbent strength).
  let addressableSpend = 0
  const competitorSpend = new Map<string, { name: string; spend: number }>()
  if (canonicalCats.size > 0 && facilityIds.size > 0) {
    const marketRows = await prisma.cOGRecord.findMany({
      where: {
        facilityId: { in: [...facilityIds] },
        transactionDate: { gte: windowStart, lte: windowEnd },
        category: { not: null },
      },
      select: {
        extendedPrice: true,
        category: true,
        vendorId: true,
        vendor: { select: { name: true, displayName: true } },
      },
    })
    for (const r of marketRows) {
      if (!r.category || !canonicalCats.has(canonicalizeCategoryName(r.category)))
        continue
      const spend = Number(r.extendedPrice ?? 0)
      addressableSpend += spend
      // Tally competitors (every vendor in the category EXCEPT the caller).
      if (r.vendorId && r.vendorId !== vendor.id) {
        const name = r.vendor?.displayName ?? r.vendor?.name ?? "Unknown vendor"
        const cur = competitorSpend.get(r.vendorId) ?? { name, spend: 0 }
        cur.spend += spend
        competitorSpend.set(r.vendorId, cur)
      }
    }
  }

  const topCompetitor = [...competitorSpend.values()].sort(
    (a, b) => b.spend - a.spend,
  )[0]

  const currentAsp = vendorQty > 0 ? currentRevenue / vendorQty : 0
  const currentShare =
    addressableSpend > 0 ? Math.min(1, currentRevenue / addressableSpend) : 0

  // ── Real strategic signals ─────────────────────────────────────
  const competitiveThreat = topCompetitor?.name ?? null
  const topCompetitorSharePct =
    addressableSpend > 0 && topCompetitor
      ? clamp01(topCompetitor.spend / addressableSpend)
      : 0
  const sumEarnedRebates = vendorRebates.reduce(
    (s, r) => s + Number(r.rebateEarned ?? 0),
    0,
  )
  const rebateCostPct =
    currentRevenue > 0 ? clamp01(sumEarnedRebates / currentRevenue) : 0
  const distinctTypes = new Set(vendorContracts.map((c) => c.contractType))
  const contractTypeCount = distinctTypes.size
  const hasCapitalContract =
    distinctTypes.has("capital") || distinctTypes.has("tie_in")

  return serialize({
    currentAsp,
    currentRevenue,
    addressableSpend,
    currentShare,
    competitiveThreat,
    topCompetitorSharePct,
    rebateCostPct,
    contractTypeCount,
    hasCapitalContract,
    hasData: vendorRows.length > 0,
  })
}
