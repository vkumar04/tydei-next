"use client"

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import {
  getRebateOpportunities,
  setSpendTarget,
  getSpendTargets,
} from "@/lib/actions/rebate-optimizer"

export function useRebateOpportunities(facilityId: string) {
  return useQuery({
    queryKey: queryKeys.rebateOptimizer.opportunities(facilityId),
    queryFn: () => getRebateOpportunities(facilityId),
  })
}

export function useSpendTargets(facilityId: string) {
  return useQuery({
    queryKey: queryKeys.rebateOptimizer.spendTargets(facilityId),
    queryFn: () => getSpendTargets(facilityId),
  })
}

export function useSetSpendTarget() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: (input: {
      contractId: string
      facilityId: string
      targetSpend: number
      targetDate: string
    }) => setSpendTarget(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["rebateOptimizer"] })
    },
  })
}
