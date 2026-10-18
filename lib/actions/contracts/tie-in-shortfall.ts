"use server"

/**
 * Tie-in CAPITAL shortfall carry-forward ledger (E2, Charles 2026-06-06).
 *
 * The engine (lib/rebates/engine/tie-in-capital.ts) carries the capital
 * shortfall forward one period at a time at RUNTIME via
 * `options.carriedForwardShortfall` — it was never persisted, so the
 * carry-forward couldn't be tracked or audited. This module folds the whole
 * schedule into a per-period waterfall (`buildShortfallWaterfall`) and persists
 * it to `ContractTieInShortfallLedger`.
 *
 * Reuse note: the per-period `scheduledDueBase` (amortizationDue) and the
 * per-period `rebateEarned` (collected rebate bucketed into the amortization
 * window) come straight from `getContractCapitalSchedule` — the SAME source
 * the amortization card renders — so the ledger can never disagree with the
 * schedule. No amortization math is duplicated here. The ledger is persisted
 * at the aggregate (contract) level with `lineItemId = null`, matching the
 * aggregated schedule that surface exposes; per-line-item detail would require
 * allocating collected rebate across items, which no existing surface does.
 */

import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { requireCanMutate } from "@/lib/actions/auth-permissions"
import { contractOwnershipWhere } from "@/lib/actions/contracts-auth"
import type { TrueUpShortfallHandling } from "@/lib/generated/prisma/client"
import {
  recomputeTieInShortfallLedgerWithFacility,
  type RecomputeTieInShortfallResult,
} from "@/lib/contracts/recompute/tie-in-shortfall-engine"

export type { RecomputeTieInShortfallResult } from "@/lib/contracts/recompute/tie-in-shortfall-engine"

/**
 * Recompute + persist the shortfall carry-forward waterfall for one contract.
 * No-op (periodsPersisted 0) for non-tie-in/capital contracts or contracts
 * with no amortization schedule. Never throws on a non-capital contract.
 *
 * Auth-gated entry point — resolves the facility from the session, then
 * delegates to `recomputeTieInShortfallLedgerWithFacility`. Called from the
 * contract-detail "Recompute Earned Rebates" button.
 */
export async function recomputeTieInShortfallLedger(
  contractId: string,
): Promise<RecomputeTieInShortfallResult> {
  const { facility } = await requireFacility()
  await requireCanMutate()
  return recomputeTieInShortfallLedgerWithFacility(contractId, facility.id)
}

export interface TieInShortfallLedgerRow {
  id: string
  contractId: string
  lineItemId: string | null
  periodNumber: number
  scheduledDue: number
  rebateEarned: number
  periodShortfall: number
  carriedForwardBalance: number
  runningBalance: number
  shortfallHandling: TrueUpShortfallHandling
}

/** Read the persisted shortfall ledger for one contract (ordered for display). */
export async function getTieInShortfallLedger(
  contractId: string,
): Promise<TieInShortfallLedgerRow[]> {
  const { facility } = await requireFacility()

  const contract = await prisma.contract.findFirst({
    where: contractOwnershipWhere(contractId, facility.id),
    select: { id: true },
  })
  if (!contract) return []

  const rows = await prisma.contractTieInShortfallLedger.findMany({
    where: { contractId },
    orderBy: [{ lineItemId: "asc" }, { periodNumber: "asc" }],
  })

  return rows.map((r) => ({
    id: r.id,
    contractId: r.contractId,
    lineItemId: r.lineItemId,
    periodNumber: r.periodNumber,
    scheduledDue: Number(r.scheduledDue),
    rebateEarned: Number(r.rebateEarned),
    periodShortfall: Number(r.periodShortfall),
    carriedForwardBalance: Number(r.carriedForwardBalance),
    runningBalance: Number(r.runningBalance),
    shortfallHandling: r.shortfallHandling,
  }))
}
