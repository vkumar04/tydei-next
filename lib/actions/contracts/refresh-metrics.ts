"use server"

/**
 * Persist the canonically-derived metrics back onto the Contract row.
 *
 * Strategic-direction Plan #1 (`docs/superpowers/specs/2026-04-28-strategic-direction.md`):
 * Contract.complianceRate, Contract.currentMarketShare, and
 * Contract.annualValue should all be COMPUTED, not manually entered.
 * The form still shows them today as a transition step; this action
 * is what keeps the persisted values fresh:
 *
 *   - On COG import: auto-fired by `bulkImportCOGRecords` for every
 *     contract whose vendor had rows imported.
 *   - On contract-detail "Refresh Metrics" button: user-triggered.
 *   - Future nightly cron: catches contracts whose underlying COG
 *     hasn't moved but whose date window has shifted.
 *
 * Failure modes are loud — the action returns a structured result and
 * the caller decides whether to surface the failure (toast for the
 * button click) or swallow it (best-effort during import). No
 * `console.warn` swallowing here; per CLAUDE.md AI-action error path
 * rule, errors are logged with context before re-throwing.
 */
import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { contractOwnershipWhere } from "@/lib/actions/contracts-auth"
import { computeContractMetrics } from "@/lib/actions/contracts/derived-metrics"

export interface RefreshContractMetricsResult {
  contractId: string
  complianceRate: number | null
  currentMarketShare: number | null
  annualValue: number | null
  /** Diagnostics surfaced for the UI's "last computed" display. */
  cogRowsConsidered: number
  /** Set if any field was actually changed by the refresh. */
  changed: boolean
}

/**
 * Recompute and persist the derived metrics for ONE contract. Caller
 * provides the contractId; auth happens via requireFacility() so the
 * action can't be called for someone else's contract.
 */
export async function refreshContractMetrics(
  contractId: string,
): Promise<RefreshContractMetricsResult> {
  const { facility } = await requireFacility()
  try {
    const contract = await prisma.contract.findFirstOrThrow({
      where: contractOwnershipWhere(contractId, facility.id),
      select: {
        id: true,
        totalValue: true,
        annualValue: true,
        effectiveDate: true,
        expirationDate: true,
        complianceRate: true,
        currentMarketShare: true,
      },
    })

    // Compliance + market share via the canonical helper.
    const metrics = await computeContractMetrics({ contractId })

    // annualValue: derive from totalValue / years when missing or
    // wildly off (>25% drift, the schema-invariants oracle threshold).
    const totalValue = Number(contract.totalValue)
    const yearsMs =
      contract.expirationDate.getTime() - contract.effectiveDate.getTime()
    const years = Math.max(yearsMs / (1000 * 60 * 60 * 24 * 365.25), 1)
    let derivedAnnualValue: number | null = null
    if (totalValue > 0) {
      derivedAnnualValue = Math.round(totalValue / years)
    }

    const before = {
      complianceRate:
        contract.complianceRate == null ? null : Number(contract.complianceRate),
      currentMarketShare:
        contract.currentMarketShare == null
          ? null
          : Number(contract.currentMarketShare),
      annualValue:
        contract.annualValue == null ? null : Number(contract.annualValue),
    }

    const after = {
      complianceRate: metrics.complianceRate,
      currentMarketShare: metrics.currentMarketShare,
      // Only overwrite annualValue when totalValue is set AND the
      // current stored value drifts >25% from derived. Preserves
      // intentional non-uniform-payment schedules (e.g. ramping
      // commitments) — the schema-invariants oracle uses the same
      // 25% band.
      annualValue:
        derivedAnnualValue == null || before.annualValue == null
          ? derivedAnnualValue
          : Math.abs(before.annualValue - derivedAnnualValue) /
              Math.max(1, derivedAnnualValue) >
            0.25
            ? derivedAnnualValue
            : before.annualValue,
    }

    const changed =
      before.complianceRate !== after.complianceRate ||
      before.currentMarketShare !== after.currentMarketShare ||
      before.annualValue !== after.annualValue

    if (changed) {
      // auth-scope-scanner-skip: contractOwnershipWhere already ran on
      // the findFirstOrThrow above; this update is the gated mutation.
      // Contract.annualValue is non-nullable — only write it when we
      // have a derived value. Null persists as the prior stored value.
      await prisma.contract.update({
        where: { id: contractId },
        data: {
          complianceRate: after.complianceRate,
          currentMarketShare: after.currentMarketShare,
          ...(after.annualValue != null
            ? { annualValue: after.annualValue }
            : {}),
        },
      })
    }

    return {
      contractId,
      complianceRate: after.complianceRate,
      currentMarketShare: after.currentMarketShare,
      annualValue: after.annualValue,
      cogRowsConsidered: metrics.cogRowsTotal,
      changed,
    }
  } catch (err) {
    console.error("[refreshContractMetrics]", err, {
      facilityId: facility.id,
      contractId,
    })
    throw err
  }
}

/**
 * Bulk variant — refresh every contract at the facility owned by the
 * given vendor. Called from `bulkImportCOGRecords` after the COG +
 * recompute pipeline finishes so the metrics fields stay synced
 * automatically. Errors are collected per-contract; one bad contract
 * doesn't stop the others.
 */
export async function refreshContractMetricsForVendor(input: {
  vendorId: string
  facilityId: string
}): Promise<{
  refreshed: number
  changed: number
  errored: number
}> {
  const contracts = await prisma.contract.findMany({
    where: {
      facilityId: input.facilityId,
      vendorId: input.vendorId,
      status: { in: ["active", "expiring"] },
    },
    select: { id: true },
  })

  let refreshed = 0
  let changed = 0
  let errored = 0
  for (const c of contracts) {
    try {
      const r = await refreshContractMetrics(c.id)
      refreshed++
      if (r.changed) changed++
    } catch (err) {
      errored++
      console.warn(
        `[refreshContractMetricsForVendor] contract ${c.id} failed:`,
        err,
      )
    }
  }
  return { refreshed, changed, errored }
}
