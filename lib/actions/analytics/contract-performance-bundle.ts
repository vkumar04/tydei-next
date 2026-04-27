"use server"

/**
 * Performance-tab data bundle. Replaces the 4-6 sequential server
 * actions the contract-detail Performance tab fired on mount with
 * a single round-trip. Each action still works standalone for
 * surfaces that only need one piece — this is purely an aggregator.
 *
 * Includes are conditional on contract type so we don't pay for
 * tie-in / SLA computation on a usage contract.
 *
 * 2026-04-27: Contract Composite Score removed entirely (per request).
 * The bundle now only carries forecast + optional tieIn. The aggregator
 * stays so future analytics surfaces can plug in here without touching
 * call sites.
 */

import { prisma } from "@/lib/db"
import { serialize } from "@/lib/serialize"
import { requireContractScope } from "@/lib/actions/analytics/_scope"
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
  forecast: RebateForecast
  tieIn: TieInComplianceResult | null
}

export async function getContractPerformanceBundle(
  contractId: string,
): Promise<ContractPerformanceBundle> {
  await requireContractScope(contractId)

  const contractType = await prisma.contract
    .findFirstOrThrow({
      where: { id: contractId },
      select: { contractType: true },
    })
    .then((c) => c.contractType)

  const [forecast, tieIn] = await Promise.all([
    getRebateForecast(contractId),
    contractType === "tie_in"
      ? getTieInCompliance(contractId)
      : Promise.resolve(null),
  ])

  return serialize({
    contractId,
    contractType,
    forecast,
    tieIn,
  })
}
