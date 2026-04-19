"use client"

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import {
  getContractPerformanceHistory,
  getExpiringContracts,
  getRenewalSummary,
} from "@/lib/actions/renewals"
import { submitRenewalProposal } from "@/lib/actions/renewals/proposals"

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

/**
 * Vendor — submit a renewal proposal.
 *
 * Writes a `ContractChangeProposal` (proposalType `contract_edit`,
 * status `pending`, semantic `kind: "renewal"` in `changes`). Replaces
 * the legacy `useInitiateRenewal` mutation — see plan W1.4 in
 * docs/superpowers/plans/2026-04-19-renewals-v0-parity.md.
 */
export function useSubmitRenewalProposal() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: (input: {
      contractId: string
      notes: string
      proposedTerms?: {
        effectiveDate: string | null
        expirationDate: string | null
        priceChangePercent: number | null
        rebateRateChangePercent: number | null
        narrative: string | null
      }
    }) =>
      submitRenewalProposal({
        contractId: input.contractId,
        notes: input.notes,
        proposedTerms: input.proposedTerms ?? {
          effectiveDate: null,
          expirationDate: null,
          priceChangePercent: null,
          rebateRateChangePercent: null,
          narrative: null,
        },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["renewals"] })
      void qc.invalidateQueries({ queryKey: ["contracts"] })
    },
  })
}
