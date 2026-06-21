"use client"

import { useQuery } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import { useToastMutation } from "@/hooks/use-toast-mutation"
import {
  getRebateOpportunities,
  setSpendTarget,
  getSpendTargets,
} from "@/lib/actions/rebate-optimizer"
import { getRebateOpportunities as getRebateOpportunitiesEngine } from "@/lib/actions/rebate-optimizer-engine"

export function useRebateOpportunities(facilityId: string) {
  return useQuery({
    queryKey: queryKeys.rebateOptimizer.opportunities(facilityId),
    queryFn: () => getRebateOpportunities(facilityId),
  })
}

/**
 * Engine-wired opportunity query for the scenario-builder flow.
 *
 * Uses the new server action (`lib/actions/rebate-optimizer-engine.ts`)
 * which returns the canonical `RebateOpportunity` shape + dropped contracts
 * + ranked alerts via the pure engines in `lib/rebate-optimizer/`.
 */
export function useRebateOptimizerEngine(facilityId: string) {
  return useQuery({
    queryKey: [...queryKeys.rebateOptimizer.opportunities(facilityId), "engine"] as const,
    queryFn: () => getRebateOpportunitiesEngine(),
    staleTime: 30_000,
    enabled: Boolean(facilityId),
  })
}

export function useSpendTargets(facilityId: string) {
  return useQuery({
    queryKey: queryKeys.rebateOptimizer.spendTargets(facilityId),
    queryFn: () => getSpendTargets(facilityId),
  })
}

export function useSetSpendTarget() {
  return useToastMutation(
    (input: {
      contractId: string
      facilityId: string
      targetSpend: number
      targetDate: string
    }) => setSpendTarget(input),
    { invalidate: [queryKeys.rebateOptimizer.all] },
  )
}
