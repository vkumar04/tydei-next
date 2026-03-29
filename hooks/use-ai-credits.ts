"use client"

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  getAICredits,
  useAICredits,
  getAIUsageHistory,
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
  const isLow = credit ? credit.remaining < 20 : false
  const isEmpty = credit ? credit.remaining <= 0 : true

  return { isLow, isEmpty, remaining: credit?.remaining ?? 0 }
}
