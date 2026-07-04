"use server"

/**
 * Vendor Opportunity Engine — real DB seed.
 *
 * Derives the deal-scenario starting point from the vendor's own data:
 *   - currentAsp / currentRevenue  → the vendor's trailing-12mo COG sales
 *     (rows in facility COGRecord attributed to this vendor)
 *   - addressableSpend             → total facility spend in the categories
 *     the vendor competes in, across the facilities it sells to — FACILITY
 *     data, so only facilities with an accepted `two_way` Connection count
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
import { callerVendorDivisionIds } from "@/lib/actions/division-auth"
import {
  divisionCategoryKeySet,
  categoryInDivisionScope,
} from "@/lib/divisions/category-scope"
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
  /**
   * Top competing vendor by spend in the vendor's categories, or null.
   * FACILITY-side data — derived only from facilities with an accepted
   * `two_way` connection; a one-way-only vendor always gets null.
   */
  competitiveThreat: string | null
  /**
   * That competitor's share of the addressable market, 0–1 (incumbent
   * strength). Null when competitor data is unavailable (no two-way
   * connections, or no competitor rows) — never a fabricated 0.
   */
  topCompetitorSharePct: number | null
  /** Vendor's trailing-12mo earned rebates ÷ revenue, 0–1 (rebate cost). */
  rebateCostPct: number
  /** Distinct active ContractType the vendor holds (0–6) — multi-BU breadth. */
  contractTypeCount: number
  /** Whether the vendor holds a capital/tie_in contract (equipment/tech presence). */
  hasCapitalContract: boolean
  /**
   * Per-category benchmark position for the Deal Scenario: the vendor's actual
   * trailing-12mo ASP vs the UPLOADED benchmark average (Vick 2026-06-22 — see
   * where actuals/assumptions sit vs benchmark). `benchmarkAvg` is null when the
   * vendor has uploaded no benchmark for that category.
   */
  categoryBenchmarks: VendorCategoryBenchmark[]
  hasData: boolean
}

export interface VendorCategoryBenchmark {
  category: string
  /** Actual: trailing-12mo COG ASP (spend ÷ qty) for the category. */
  currentAsp: number
  /** Uploaded benchmark average unit price for the category, or null. */
  benchmarkAvg: number | null
}

/**
 * @param facilityId — optional facility scope. When provided (non-empty), the
 * vendor-rows query, the addressable/competitor market query, and the facility
 * set are all restricted to that ONE facility, so the Opportunity Engine
 * models "this facility" instead of the vendor's whole book of business.
 * Tenant-safe narrowing (mirrors `scopeContractWhereToFacility`'s philosophy):
 * every query stays vendor-scoped first, so a bad/foreign facilityId simply
 * returns empty — never another vendor's data. Division scoping is unchanged.
 */
export async function getVendorOpportunityData(
  facilityId?: string,
): Promise<VendorOpportunityData> {
  const { vendor, user } = await requireVendor()
  const scopedFacilityId = facilityId?.trim() || undefined
  // Division isolation: contract-derived inputs scope by vendorDivisionId;
  // facility COGRecord rows carry no division column, so the revenue/ASP
  // figures scope by the caller's division CATEGORIES instead
  // (lib/divisions/category-scope.ts — divisions with no categories declared
  // fall back to vendor-wide).
  const divisionIds = await callerVendorDivisionIds(user.id, vendor.id)
  const divisionCategoryKeys = await divisionCategoryKeySet(divisionIds)

  const { start: windowStart, end: windowEnd } = getTrailing12MonthWindow()

  // The vendor's own sales (trailing 12mo) across every facility, plus the
  // contract mix + earned rebates that drive the real strategic-score inputs.
  const [vendorRows, vendorContracts, vendorRebates] = await Promise.all([
    prisma.cOGRecord.findMany({
      where: {
        vendorId: vendor.id,
        transactionDate: { gte: windowStart, lte: windowEnd },
        // Facility narrowing — vendor-scoped first, so this only NARROWS.
        ...(scopedFacilityId ? { facilityId: scopedFacilityId } : {}),
      },
      select: {
        extendedPrice: true,
        quantity: true,
        category: true,
        facilityId: true,
      },
    }),
    prisma.contract.findMany({
      where: {
        ...contractsOwnedByVendor(vendor.id, divisionIds),
        status: { in: ["active", "expiring"] },
      },
      select: { contractType: true },
    }),
    prisma.rebate.findMany({
      where: {
        contract: contractsOwnedByVendor(vendor.id, divisionIds),
        payPeriodEnd: { gte: windowStart, lte: windowEnd },
      },
      select: { rebateEarned: true },
    }),
  ])

  let currentRevenue = 0
  let vendorQty = 0
  const canonicalCats = new Set<string>()
  const facilityIds = new Set<string>()
  // Per-category actuals (spend + qty → ASP) for the benchmark-position card.
  const catAgg = new Map<string, { label: string; spend: number; qty: number }>()
  const scopedVendorRows = vendorRows.filter((r) =>
    categoryInDivisionScope(r.category, divisionCategoryKeys),
  )
  for (const r of scopedVendorRows) {
    const spend = Number(r.extendedPrice ?? 0)
    currentRevenue += spend
    vendorQty += r.quantity ?? 0
    if (r.category) {
      const key = canonicalizeCategoryName(r.category)
      canonicalCats.add(key)
      const cur = catAgg.get(key) ?? { label: r.category, spend: 0, qty: 0 }
      cur.spend += spend
      cur.qty += r.quantity ?? 0
      catAgg.set(key, cur)
    }
    facilityIds.add(r.facilityId)
  }

  // Uploaded benchmarks only (vendorId = vendor.id) → per-category average unit
  // price. Seeded/national rows (vendorId = null) are excluded by design.
  const uploadedBenchmarks = await prisma.productBenchmark.findMany({
    where: { vendorId: vendor.id },
    select: { category: true, nationalAvgPrice: true },
  })
  const benchAgg = new Map<string, { sum: number; n: number }>()
  for (const b of uploadedBenchmarks) {
    if (!b.category || b.nationalAvgPrice == null) continue
    const key = canonicalizeCategoryName(b.category)
    const cur = benchAgg.get(key) ?? { sum: 0, n: 0 }
    cur.sum += Number(b.nationalAvgPrice)
    cur.n += 1
    benchAgg.set(key, cur)
  }
  const categoryBenchmarks: VendorCategoryBenchmark[] = [...catAgg.entries()]
    .map(([key, agg]) => {
      const bench = benchAgg.get(key)
      return {
        category: agg.label,
        currentAsp: agg.qty > 0 ? agg.spend / agg.qty : 0,
        benchmarkAvg: bench && bench.n > 0 ? bench.sum / bench.n : null,
      }
    })
    .sort((a, b) => b.currentAsp - a.currentAsp)

  // Total facility spend in those categories + facilities = addressable market.
  // Also aggregate spend by the OTHER vendors competing in those categories so
  // we can name the real top competitor + their share (incumbent strength).
  //
  // MODE GATE: the addressable market / competitor mix is FACILITY-side data
  // (COG rows across ALL vendors), so it flows only for facilities with an
  // accepted `two_way` Connection — the same gate as
  // `getFacilityActualsForVendor` (Charles 2026-06-30: "Where is it getting
  // the competitive threat from? … Is it in 2 way mode for some things?").
  // The vendor's OWN sales rows above (vendorId = self) stay regardless of
  // mode. A one-way-only vendor gets addressableSpend 0 → the engine falls
  // back to its own scoped revenue path, exactly as when `hasData` is false
  // for those pieces.
  let addressableSpend = 0
  const competitorSpend = new Map<string, { name: string; spend: number }>()
  if (canonicalCats.size > 0 && facilityIds.size > 0) {
    const twoWayConnections = await prisma.connection.findMany({
      where: {
        vendorId: vendor.id,
        status: "accepted",
        mode: "two_way",
        facilityId: { in: [...facilityIds] },
      },
      select: { facilityId: true },
    })
    const twoWayFacilityIds = twoWayConnections.map((c) => c.facilityId)
    if (twoWayFacilityIds.length > 0) {
      const marketRows = await prisma.cOGRecord.findMany({
        where: {
          // twoWayFacilityIds ⊆ facilityIds, and when facility-scoped the
          // vendor-rows query was already narrowed to scopedFacilityId — so
          // this can only NARROW (drops non-two-way facilities), never widen
          // the addressable/competitor market past the scope.
          facilityId: { in: twoWayFacilityIds },
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
        if (
          !r.category ||
          !canonicalCats.has(canonicalizeCategoryName(r.category))
        )
          continue
        const spend = Number(r.extendedPrice ?? 0)
        addressableSpend += spend
        // Tally competitors (every vendor in the category EXCEPT the caller).
        if (r.vendorId && r.vendorId !== vendor.id) {
          const name =
            r.vendor?.displayName ?? r.vendor?.name ?? "Unknown vendor"
          const cur = competitorSpend.get(r.vendorId) ?? { name, spend: 0 }
          cur.spend += spend
          competitorSpend.set(r.vendorId, cur)
        }
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
      : null
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
    categoryBenchmarks,
    hasData: vendorRows.length > 0,
  })
}
