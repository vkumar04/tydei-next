"use server"

/**
 * Performance-tab data bundle. Replaces the 4-6 sequential server
 * actions the contract-detail Performance tab fired on mount with
 * a single round-trip. Each action still works standalone for
 * surfaces that only need one piece — this is purely an aggregator.
 *
 * Includes are conditional on contract type so we don't pay for
 * tie-in / SLA computation on a usage contract.
 */

import { prisma } from "@/lib/db"
import { serialize } from "@/lib/serialize"
import { requireContractScope } from "@/lib/actions/analytics/_scope"
import { getContractCompositeScore } from "@/lib/actions/analytics/contract-score"
import type { ContractCompositeScore } from "@/lib/actions/analytics/contract-score-impl"
import { getRenewalRisk } from "@/lib/actions/analytics/renewal-risk"
import {
  getRebateForecast,
  type RebateForecast,
} from "@/lib/actions/analytics/rebate-forecast"
import {
  getTieInCompliance,
  type TieInComplianceResult,
} from "@/lib/actions/analytics/tie-in-compliance"

export interface ContractPerformanceBundle {
  contractId: string
  contractType: string
  score: ContractCompositeScore
  risk: Awaited<ReturnType<typeof getRenewalRisk>>
  forecast: RebateForecast
  tieIn: TieInComplianceResult | null
}

export async function getContractPerformanceBundle(
  contractId: string,
): Promise<ContractPerformanceBundle> {
  // Single scope check; React `cache()` on requireContractScope
  // dedupes the inner per-action checks for the same contractId
  // within this request.
  await requireContractScope(contractId)

  const contractType = await prisma.contract
    .findFirstOrThrow({
      where: { id: contractId },
      select: { contractType: true },
    })
    .then((c) => c.contractType)

  // Run the four (or three) analytics in parallel. They each
  // perform their own ownership check via requireContractScope,
  // which the React cache wrapper deduplicates back to one
  // database hit.
  const [score, risk, forecast, tieIn] = await Promise.all([
    getContractCompositeScore(contractId),
    getRenewalRisk(contractId),
    getRebateForecast(contractId),
    contractType === "tie_in"
      ? getTieInCompliance(contractId)
      : Promise.resolve(null),
  ])

  return serialize({
    contractId,
    contractType,
    score,
    risk,
    forecast,
    tieIn,
  })
}
