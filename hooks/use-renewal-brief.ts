"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { generateRenewalBrief } from "@/lib/actions/contracts/renewal-brief"
import type { RenewalBrief } from "@/lib/ai/renewal-brief-schemas"
import { queryKeys } from "@/lib/query-keys"

/**
 * Lazy query for the AI-generated Renewal Brief. Disabled by default — the
 * UI flips `enabled` to true once the user clicks "Generate Renewal Brief".
 * Returns the server-cached brief on revisit until the 1-hour TTL elapses.
 */
export function useRenewalBrief(
  contractId: string,
  opts?: { enabled?: boolean },
) {
  return useQuery<RenewalBrief>({
    queryKey: queryKeys.contracts.renewalBrief(contractId),
    queryFn: () => generateRenewalBrief(contractId),
    enabled: Boolean(contractId) && (opts?.enabled ?? false),
    staleTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: false,
  })
}

/**
 * Force-refresh the renewal brief (bypasses the server cache). On success,
 * writes the fresh payload into the TanStack cache so the UI updates without
 * a flicker.
 */
export function useRegenerateRenewalBrief(contractId: string) {
  const qc = useQueryClient()

  return useMutation<RenewalBrief>({
    mutationFn: () => generateRenewalBrief(contractId, { forceFresh: true }),
    onSuccess: (data) => {
      qc.setQueryData(queryKeys.contracts.renewalBrief(contractId), data)
    },
  })
}
