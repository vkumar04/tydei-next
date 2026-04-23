"use client"

import { useState } from "react"
import { toast } from "sonner"
import {
  useClearRebateInsightFlag,
  useFlagRebateInsight,
  useRebateInsightFlags,
  useRebateInsights,
  useRegenerateRebateInsights,
} from "@/hooks/use-rebate-insights"
import type { RebateInsight } from "@/lib/ai/rebate-optimizer-schemas"

/**
 * Encapsulates the AI Smart Recommendations state for the rebate
 * optimizer page: gated initial load, regenerate, flag/unflag, and
 * the derived loading/error/data shape consumed by `AiInsightsPanel`.
 */
export function useOptimizerAiInsights(facilityId: string) {
  const [open, setOpen] = useState(false)
  const [enabled, setEnabled] = useState(false)

  const insightsQuery = useRebateInsights(facilityId, { enabled })
  const regenerate = useRegenerateRebateInsights(facilityId)
  const flag = useFlagRebateInsight(facilityId)
  const clear = useClearRebateInsightFlag(facilityId)
  const flagsQuery = useRebateInsightFlags(facilityId)

  const data = insightsQuery.data ?? regenerate.data ?? null
  const loading =
    (enabled && insightsQuery.isPending && !insightsQuery.data) ||
    regenerate.isPending
  const error = insightsQuery.error ?? regenerate.error ?? null
  const flags = flagsQuery.data ?? []
  const flaggedIds = new Set(flags.map((f) => f.insightId))

  function handleGenerate() {
    if (!enabled) {
      setEnabled(true)
      return
    }
    regenerate.mutate()
  }

  function handleFlag(insight: RebateInsight) {
    flag.mutate(
      { insightId: insight.id, snapshot: insight },
      {
        onSuccess: () => toast.success("Flagged for review"),
        onError: (err) =>
          toast.error(
            err instanceof Error ? err.message : "Could not flag insight",
          ),
      },
    )
  }

  return {
    open,
    setOpen,
    enabled,
    data,
    loading,
    error,
    regeneratePending: regenerate.isPending,
    flags,
    flaggedIds,
    flagPending: flag.isPending,
    clearPending: clear.isPending,
    onGenerate: handleGenerate,
    onRegenerate: () => regenerate.mutate(),
    onFlag: handleFlag,
    onClearFlag: (id: string) => clear.mutate(id),
  }
}
