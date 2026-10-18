"use server"

import { requireFacility } from "@/lib/actions/auth"
import { requireCanMutate } from "@/lib/actions/auth-permissions"
import { invalidateContractAnalytics, invalidateFacilityAnalytics } from "@/lib/actions/analytics/_cache"
import {
  recomputeAccrualForContractWithFacility,
  type RecomputeAccrualResult,
} from "@/lib/contracts/recompute/accrual-engine"

export type { RecomputeAccrualResult } from "@/lib/contracts/recompute/accrual-engine"

export async function recomputeAccrualForContract(
  contractId: string,
): Promise<RecomputeAccrualResult> {
  const { facility } = await requireFacility()
  await requireCanMutate()
  const result = await recomputeAccrualForContractWithFacility(contractId, facility.id)
  await invalidateContractAnalytics(contractId)
  await invalidateFacilityAnalytics(facility.id)
  return result
}
