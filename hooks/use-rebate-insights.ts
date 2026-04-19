"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  clearRebateInsightFlag,
  flagRebateInsight,
  getRebateOptimizerInsights,
  listRebateInsightFlags,
  type RebateInsightFlagRow,
} from "@/lib/actions/rebate-optimizer-insights"
import type {
  RebateInsight,
  RebateInsightsResponse,
} from "@/lib/ai/rebate-optimizer-schemas"

const insightsQueryKey = (facilityId: string) =>
  ["rebateOptimizer", "insights", facilityId] as const

const flagsQueryKey = (facilityId: string) =>
  ["rebateOptimizer", "insightFlags", facilityId] as const

/**
 * Lazy query for AI Smart Recommendations. Disabled by default — the UI flips
 * `enabled` to true once the user clicks "Generate". Returns cached results on
 * revisit until the 15-minute TTL elapses server-side.
 */
export function useRebateInsights(
  facilityId: string,
  opts?: { enabled?: boolean },
) {
  return useQuery<RebateInsightsResponse>({
    queryKey: insightsQueryKey(facilityId),
    queryFn: () => getRebateOptimizerInsights(facilityId),
    enabled: Boolean(facilityId) && (opts?.enabled ?? false),
    staleTime: 15 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: false,
  })
}

/**
 * Force-refresh the insights (bypasses the server-side cache). On success,
 * writes the fresh payload straight into the TanStack cache so the UI swaps
 * over without a flicker.
 */
export function useRegenerateRebateInsights(facilityId: string) {
  const qc = useQueryClient()

  return useMutation<RebateInsightsResponse>({
    mutationFn: () =>
      getRebateOptimizerInsights(facilityId, { forceFresh: true }),
    onSuccess: (data) => {
      qc.setQueryData(insightsQueryKey(facilityId), data)
    },
  })
}

/** Fetch the flagged-insights follow-up feed. */
export function useRebateInsightFlags(facilityId: string) {
  return useQuery<RebateInsightFlagRow[]>({
    queryKey: flagsQueryKey(facilityId),
    queryFn: () => listRebateInsightFlags(facilityId),
    enabled: Boolean(facilityId),
  })
}

/** Flag an insight for review. Invalidates the flags feed on success. */
export function useFlagRebateInsight(facilityId: string) {
  const qc = useQueryClient()

  return useMutation<
    { id: string },
    Error,
    { insightId: string; snapshot: RebateInsight }
  >({
    mutationFn: (input) => flagRebateInsight(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: flagsQueryKey(facilityId) })
    },
  })
}

/** Clear a flagged insight. Invalidates the flags feed on success. */
export function useClearRebateInsightFlag(facilityId: string) {
  const qc = useQueryClient()

  return useMutation<void, Error, string>({
    mutationFn: (id) => clearRebateInsightFlag(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: flagsQueryKey(facilityId) })
    },
  })
}
