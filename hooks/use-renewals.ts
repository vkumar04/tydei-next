"use client"

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import {
  getContractPerformanceHistory,
  getExpiringContracts,
  getRenewalSummary,
  initiateRenewal,
} from "@/lib/actions/renewals"

export function useExpiringContracts(
  entityId: string,
  windowDays: number,
  type: "facility" | "vendor"
) {
  return useQuery({
    queryKey: queryKeys.renewals.expiring(entityId, windowDays),
    queryFn: () =>
      getExpiringContracts({
        ...(type === "facility" ? { facilityId: entityId } : { vendorId: entityId }),
        windowDays,
      }),
  })
}

export function useRenewalSummary(contractId: string) {
  return useQuery({
    queryKey: queryKeys.renewals.summary(contractId),
    queryFn: () => getRenewalSummary(contractId),
    enabled: !!contractId,
  })
}

/**
 * Lazy-load the real per-year performance history for a single contract
 * — kicks in only when the renewals detail modal opens (W1.1 fix).
 *
 * Pass `null` when nothing is selected to keep the query disabled.
 */
export function useContractPerformanceHistory(contractId: string | null) {
  return useQuery({
    queryKey: queryKeys.renewals.performanceHistory(contractId ?? ""),
    queryFn: () => getContractPerformanceHistory(contractId ?? ""),
    enabled: !!contractId,
  })
}

export function useInitiateRenewal() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: (contractId: string) => initiateRenewal(contractId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["renewals"] })
      void qc.invalidateQueries({ queryKey: ["contracts"] })
    },
  })
}
