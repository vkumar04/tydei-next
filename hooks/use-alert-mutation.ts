"use client"

import {
  useMutation,
  useQueryClient,
  type QueryKey,
} from "@tanstack/react-query"
import { toast } from "sonner"

/**
 * Shared factory for alert mutation hooks (facility + vendor). Collapses the
 * repeated `useMutation({ mutationFn, onSuccess: invalidate + toast,
 * onError: toast })` boilerplate that was spelled out ~14 times across
 * `use-alerts.ts` and `use-vendor-alerts.ts`.
 *
 * - `invalidate`: query keys to invalidate on success (prefix-based). Facility
 *   passes `[alerts.all, dashboard.all]`; vendor passes `[alerts.all]`.
 * - `success`: optional — omit for silent mutations (e.g. the detail-view
 *   auto-mark-read, which shouldn't toast on every view).
 * - `error`: optional — omit to fail silently (matches the prior silent
 *   mark-read behavior); provide a message to toast on failure.
 */
export function useAlertMutation<TArgs, TData>(
  mutationFn: (args: TArgs) => Promise<TData>,
  cfg: {
    invalidate: QueryKey[]
    success?: (data: TData) => string
    error?: string
  },
) {
  const qc = useQueryClient()
  return useMutation<TData, Error, TArgs>({
    mutationFn,
    onSuccess: (data) => {
      for (const key of cfg.invalidate) qc.invalidateQueries({ queryKey: key })
      if (cfg.success) toast.success(cfg.success(data))
    },
    onError: cfg.error
      ? (e) => toast.error(e.message || cfg.error)
      : undefined,
  })
}
