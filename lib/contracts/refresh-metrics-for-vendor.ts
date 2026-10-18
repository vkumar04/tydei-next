import { prisma } from "@/lib/db"
import { refreshContractMetrics } from "@/lib/actions/contracts/refresh-metrics"

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
      // #2 (Vick 2026-05-31): also refresh GROUPED contracts where this
      // vendor is an additional participant — otherwise importing COG for
      // vendor B leaves vendor A's grouped contract metrics stale (mirrors
      // loadContractsForVendor in lib/cog/recompute.ts).
      OR: [
        { vendorId: input.vendorId },
        { additionalVendorIds: { has: input.vendorId } },
      ],
      status: { in: ["active", "expiring"] },
    },
    select: { id: true, contractType: true },
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

    // E2 (Charles 2026-06-06): populate the tie-in capital shortfall
    // carry-forward ledger from the same recompute pipeline. The writer
    // was previously fired only by the contract-detail "Recompute Earned
    // Rebates" button, so for imported contracts the ledger stayed empty
    // and its UI section never appeared. Only tie_in/capital contracts
    // carry a capital shortfall — skip the rest to avoid needless work.
    // Best-effort: a ledger failure must NEVER break metrics refresh or
    // the import. The helper takes facilityId directly (no requireFacility)
    // so it mirrors this bulk path's auth model.
    if (c.contractType === "tie_in" || c.contractType === "capital") {
      try {
        const { recomputeTieInShortfallLedgerWithFacility } = await import(
          "@/lib/contracts/recompute/tie-in-shortfall-engine"
        )
        await recomputeTieInShortfallLedgerWithFacility(
          c.id,
          input.facilityId,
        )
      } catch (err) {
        console.error("[shortfall-ledger]", err, { contractId: c.id })
      }
    }
  }
  return { refreshed, changed, errored }
}
