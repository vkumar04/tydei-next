"use client"

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import {
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
