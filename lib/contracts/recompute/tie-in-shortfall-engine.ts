import { prisma } from "@/lib/db"
import { contractOwnershipWhere } from "@/lib/actions/contracts-auth"
import { serialize } from "@/lib/serialize"
import {
  buildShortfallWaterfall,
  type ShortfallPeriodInput,
} from "@/lib/contracts/tie-in-shortfall-waterfall"
import { getContractCapitalSchedule } from "@/lib/actions/contracts/tie-in"
import type { TrueUpShortfallHandling } from "@/lib/generated/prisma/client"

export interface RecomputeTieInShortfallResult {
  contractId: string
  periodsPersisted: number
  totalRunningBalance: number
}

/**
 * Auth-bypassing engine. Same logic as `recomputeTieInShortfallLedger` but
 * with the facility id passed in directly instead of resolved from the
 * session. Mirrors `recomputeAccrualForContractWithFacility` — used by the
 * COG-import recompute pipeline (`refreshContractMetricsForVendor`), which
 * already holds facility context and must populate the ledger automatically
 * so its UI section appears without a manual button click. The persist below
 * is still facility-scoped via `contractOwnershipWhere(contractId,
 * facilityId)`, so this can never write across facilities.
 *
 * Production UI should call the auth-gated `recomputeTieInShortfallLedger`.
 */
export async function recomputeTieInShortfallLedgerWithFacility(
  contractId: string,
  facilityId: string,
): Promise<RecomputeTieInShortfallResult> {
  const contract = await prisma.contract.findFirst({
    where: contractOwnershipWhere(contractId, facilityId),
    select: {
      id: true,
      contractType: true,
      terms: {
        select: { shortfallHandling: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      },
    },
  })

  if (!contract) {
    return { contractId, periodsPersisted: 0, totalRunningBalance: 0 }
  }

  // Only tie-in / capital contracts carry a capital shortfall.
  if (
    contract.contractType !== "tie_in" &&
    contract.contractType !== "capital"
  ) {
    return { contractId, periodsPersisted: 0, totalRunningBalance: 0 }
  }

  // Reuse the canonical schedule read — amortizationDue (scheduledDueBase) +
  // rebateAppliedThisPeriod (rebateEarned that retires capital) per period.
  const schedule = await getContractCapitalSchedule(contractId)
  if (!schedule.hasSchedule || schedule.schedule.length === 0) {
    return { contractId, periodsPersisted: 0, totalRunningBalance: 0 }
  }

  // Term-level shortfall policy. Default carry_forward (schema default + the
  // safer policy) when no term carries the field.
  const handling: TrueUpShortfallHandling =
    contract.terms.find((t) => t.shortfallHandling != null)?.shortfallHandling ??
    "carry_forward"

  const periods: ShortfallPeriodInput[] = schedule.schedule.map((row) => ({
    periodNumber: row.periodNumber,
    scheduledDueBase: row.amortizationDue,
    rebateEarned: row.rebateAppliedThisPeriod,
  }))

  const rows = buildShortfallWaterfall(periods, handling)

  await prisma.$transaction([
    prisma.contractTieInShortfallLedger.deleteMany({ where: { contractId } }),
    prisma.contractTieInShortfallLedger.createMany({
      data: rows.map((r) => ({
        contractId,
        lineItemId: null,
        periodNumber: r.periodNumber,
        scheduledDue: r.scheduledDue,
        rebateEarned: r.rebateEarned,
        periodShortfall: r.periodShortfall,
        carriedForwardBalance: r.carriedForwardBalance,
        runningBalance: r.runningBalance,
        shortfallHandling: handling,
      })),
    }),
  ])

  const totalRunningBalance = rows.reduce((a, r) => a + r.runningBalance, 0)

  return serialize({
    contractId,
    periodsPersisted: rows.length,
    totalRunningBalance,
  })
}
