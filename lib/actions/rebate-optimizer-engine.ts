"use server"

/**
 * Rebate optimizer — engine-wired server actions.
 *
 * Thin Prisma-backed wrapper around the pure engines in
 * `lib/rebate-optimizer/` (buildRebateOpportunities +
 * generateRebateAlerts). All tier math, eligibility filtering, ROI
 * ranking, urgency classification, and alert narration is delegated to
 * those pure modules — this file's only job is data loading + shape
 * translation.
 *
 * Naming note: a legacy `lib/actions/rebate-optimizer.ts` still exists
 * with a flat `RebateOpportunity[]` return shape consumed by the
 * facility rebate-optimizer components. The new engine-wired API ships
 * side-by-side here so the build stays green; components can migrate
 * independently.
 */

import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { contractsOwnedByFacility } from "@/lib/actions/contracts-auth"
import { serialize } from "@/lib/serialize"
import { toDisplayRebateValue } from "@/lib/contracts/rebate-value-normalize"
import {
  buildRebateOpportunities,
  type DroppedContract,
  type RebateOpportunity,
  type RebateOpportunityContract,
  type RebateOpportunityTerm,
  type RebateTermKind,
  type VendorSpendMap,
} from "@/lib/rebate-optimizer/engine"
import {
  generateRebateAlerts,
  type ContractForAlert,
  type RebateAlert,
} from "@/lib/rebate-optimizer/alert-generator"
import type {
  RebateTier,
  TierBoundaryRule,
  TierMethod,
} from "@/lib/rebates/engine/types"

// ─── Output shape (re-exported for callers) ─────────────────────────

export type {
  DroppedContract,
  RebateOpportunity,
} from "@/lib/rebate-optimizer/engine"
export type { RebateAlert } from "@/lib/rebate-optimizer/alert-generator"

export interface RebateOptimizerActionResult {
  opportunities: RebateOpportunity[]
  droppedContracts: DroppedContract[]
  rankedAlerts: RebateAlert[]
}

// ─── Mappers: Prisma rows → engine input shapes ─────────────────────

/**
 * Prisma TermType → engine RebateTermKind. Returns null for term types
 * the spend-rebate engine doesn't model (compliance_rebate, market_share,
 * volume_rebate, payment_rebate, fixed_fee, locked_pricing, …) so the
 * caller can drop them. Charles 2026-04-25 audit B1: previously every
 * unmapped type fell through to SPEND_REBATE, which fed an
 * occurrence/PO/invoice-count `spendMin` column to the spend optimizer
 * as if it were dollars and produced nonsense "spend $X to unlock $Y"
 * cards. Threshold-based termTypes have their own
 * ThresholdOpportunitiesCard.
 */
function mapTermKind(termType: string): RebateTermKind | null {
  if (termType === "spend_rebate" || termType === "growth_rebate") {
    return "SPEND_REBATE"
  }
  if (termType === "po_rebate") return "PO_REBATE"
  if (termType === "carve_out") return "CARVE_OUT"
  return null
}

function mapMethod(rebateMethod: string | null | undefined): TierMethod {
  return rebateMethod === "marginal" ? "MARGINAL" : "CUMULATIVE"
}

function mapBoundaryRule(rule: string | null | undefined): TierBoundaryRule {
  return rule === "inclusive" ? "INCLUSIVE" : "EXCLUSIVE"
}

interface PrismaTier {
  tierNumber: number
  tierName: string | null
  spendMin: unknown
  spendMax: unknown
  rebateValue: unknown
  rebateType?: unknown
}

function mapTier(row: PrismaTier): RebateTier {
  const max = row.spendMax === null || row.spendMax === undefined
    ? null
    : Number(row.spendMax)
  return {
    tierNumber: row.tierNumber,
    tierName: row.tierName,
    thresholdMin: Number(row.spendMin),
    thresholdMax: max,
    // Charles 2026-04-25: scale fraction → percent at the boundary so
    // the optimizer's downstream consumers (alert payloads, AI tool
    // outputs, optimizer-hero "+X% rebate" labels) see display-percent.
    // Without this every recommendation shows "+0.005% rebate" when it
    // should show "+0.5%".
    rebateValue: toDisplayRebateValue(
      String(row.rebateType ?? "percent_of_spend"),
      Number(row.rebateValue),
    ),
  }
}

// ─── Main entrypoint ────────────────────────────────────────────────

/**
 * Load active + expiring contracts for the caller's facility, aggregate
 * vendor spend from COG records, call the pure engine to build
 * opportunities + drops, then feed opportunities through the alert
 * generator for a single ranked alert feed.
 */
export async function getRebateOpportunities(): Promise<RebateOptimizerActionResult> {
  const { facility } = await requireFacility()

  const ownership = contractsOwnedByFacility(facility.id)
  const contracts = await prisma.contract.findMany({
    where: {
      ...ownership,
      status: { in: ["active", "expiring"] },
      // Include any contract whose terms has at least one tier — the
      // unified rebate engine handles every rebate type (spend_rebate,
      // volume_rebate, market_share, locked_pricing, etc.), so we no
      // longer narrow by termType. Previously the optimizer hid
      // contracts that had tiers under non-"spend_rebate" term types
      // (Charles bug bash: "No optimizable contracts…").
      terms: { some: { tiers: { some: {} } } },
    },
    include: {
      vendor: { select: { id: true, name: true } },
      terms: {
        include: {
          tiers: { orderBy: { tierNumber: "asc" } },
        },
      },
    },
  })

  // ── Vendor spend aggregates (COG) keyed by vendorId ──────────────
  const vendorIds = Array.from(
    new Set(contracts.map((c) => c.vendorId).filter(Boolean)),
  )
  const vendorSpendEntries: Array<[string, number]> = []
  if (vendorIds.length > 0) {
    const spendRows = await prisma.cOGRecord.groupBy({
      by: ["vendorId"],
      where: {
        facilityId: facility.id,
        vendorId: { in: vendorIds },
      },
      _sum: { extendedPrice: true },
    })
    for (const row of spendRows) {
      if (!row.vendorId) continue
      vendorSpendEntries.push([row.vendorId, Number(row._sum.extendedPrice ?? 0)])
    }
  }
  const vendorSpendMap: VendorSpendMap = new Map(vendorSpendEntries)

  // ── Shape contracts for the engine ───────────────────────────────
  const engineContracts: RebateOpportunityContract[] = contracts.map((c) => {
    const terms: RebateOpportunityTerm[] = c.terms
      .map((term) => {
        const kind = mapTermKind(term.termType)
        if (kind === null) return null
        return {
          termId: term.id,
          kind,
          method: mapMethod(term.rebateMethod),
          boundaryRule: mapBoundaryRule(term.boundaryRule),
          tiers: term.tiers.map(mapTier),
        }
      })
      .filter((t): t is RebateOpportunityTerm => t !== null)
    return {
      contractId: c.id,
      contractName: c.name,
      vendorId: c.vendorId,
      vendorName: c.vendor.name,
      endDate: c.expirationDate,
      terms,
    }
  })

  const { opportunities, droppedContracts } = buildRebateOpportunities(
    engineContracts,
    vendorSpendMap,
  )

  // ── Build alert-input for every opportunity, then rank ───────────
  const alertInputs: ContractForAlert[] = opportunities.map((opp) => {
    const daysUntilExpiration = opp.daysRemaining ?? Number.POSITIVE_INFINITY
    // Monthly spend rate — naive annualization: currentSpend / 12. The
    // optimizer engine treats currentSpend as the eligible 12-mo window;
    // alert module just needs a velocity estimate.
    const monthlySpendRate = opp.currentSpend > 0 ? opp.currentSpend / 12 : 0
    return {
      id: opp.contractId,
      name: opp.contractName,
      vendorName: opp.vendorName,
      currentSpend: opp.currentSpend,
      currentTierName:
        opp.currentTierNumber !== null ? `Tier ${opp.currentTierNumber}` : null,
      nextTierName: `Tier ${opp.nextTierNumber}`,
      nextTierThreshold: opp.nextTierThreshold,
      additionalRebateIfReached: opp.additionalRebate,
      daysUntilExpiration,
      monthlySpendRate,
    }
  })
  const rankedAlerts = generateRebateAlerts(alertInputs)

  return serialize({
    opportunities,
    droppedContracts,
    rankedAlerts,
  })
}
