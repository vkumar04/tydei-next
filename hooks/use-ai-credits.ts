"use client"

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  getAICredits,
  useAICredits,
  getAIUsageHistory,
  getAIUsageBreakdown,
  checkAICredits,
  type AICredit,
} from "@/lib/actions/ai-credits"
import type { AIAction } from "@/lib/ai/config"
import { queryKeys } from "@/lib/query-keys"

export function useCredits(entityId: string, type: "facility" | "vendor") {
  return useQuery({
    queryKey: queryKeys.ai.credits(entityId),
    queryFn: () =>
      getAICredits(
        type === "facility"
          ? { facilityId: entityId }
          : { vendorId: entityId }
      ),
  })
}

export function useUsageHistory(creditId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.ai.usageHistory(creditId ?? ""),
    queryFn: () => getAIUsageHistory(creditId!),
    enabled: !!creditId,
  })
}

/**
 * Per-action rollup over the credit's full billing period. The
 * AI Credits tab's "Total Credits" column previously aggregated
 * client-side from `useUsageHistory` (which is capped at 50 rows),
 * which silently UNDER-reported any facility/vendor with >50 calls
 * in a period. Use this hook for accurate totals.
 */
export function useUsageBreakdown(creditId: string | undefined) {
  return useQuery({
    queryKey: ["ai", "breakdown", creditId ?? ""],
    queryFn: () => getAIUsageBreakdown(creditId!),
    enabled: !!creditId,
    staleTime: 60_000,
  })
}

export function useConsumeCredits() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: useAICredits,
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["ai", "credits"],
      })
      if (!_data.success) {
        toast.error("Insufficient AI credits")
      }
    },
  })
}

export function useCheckCredits(
  entityId: string,
  type: "facility" | "vendor",
  action: AIAction
) {
  return useQuery({
    queryKey: ["ai", "check", entityId, action],
    queryFn: () =>
      checkAICredits({
        ...(type === "facility"
          ? { facilityId: entityId }
          : { vendorId: entityId }),
        action,
      }),
  })
}

export function useCreditGuard(credit: AICredit | null | undefined) {
  // No credit record = unlimited (no billing set up yet)
  if (!credit) return { isLow: false, isEmpty: false, remaining: Infinity }

  const isLow = credit.remaining < 20
  const isEmpty = credit.remaining <= 0

  return { isLow, isEmpty, remaining: credit.remaining }
}
