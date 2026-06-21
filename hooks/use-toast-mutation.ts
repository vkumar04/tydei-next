"use client"

import {
  useMutation,
  useQueryClient,
  type QueryKey,
} from "@tanstack/react-query"
import { toast } from "sonner"

/**
 * Shared factory for the dominant TanStack mutation shape across this repo's
 * `hooks/`: run a server action, invalidate one or more query keys on success,
 * then toast success/error. It collapses the ~60 hand-written
 * `useMutation({ mutationFn, onSuccess: invalidate + toast, onError: toast })`
 * blocks that were spelled out across ~two-dozen hook files.
 *
 * Config:
 * - `invalidate`: query keys to invalidate on success (prefix-based). Omit for
 *   a mutation that doesn't refresh any cache.
 * - `success`: a static string OR a function of the returned data
 *   (`(data) => string`). Omit for silent-on-success mutations (e.g. the
 *   alert auto-mark-read, which shouldn't toast on every detail view).
 * - `error`: fallback toast message on failure (the thrown `Error.message`
 *   wins when present). Omit to fail silently — matches the prior
 *   no-`onError` hooks (the caller surfaces the error itself).
 * - `onSuccess`: rare extra side-effect hook, fired BEFORE the success toast
 *   with `(data, args)`. Use for non-cache work; cache writes that depend on
 *   `args` should stay a bespoke `useMutation`.
 *
 * `TArgs` defaults to `void` so no-arg actions' `.mutate()` typechecks without
 * the caller spelling explicit generics; pass them when the action takes input.
 */
export function useToastMutation<TArgs = void, TData = unknown>(
  mutationFn: (args: TArgs) => Promise<TData>,
  cfg: {
    invalidate?: QueryKey[]
    success?: string | ((data: TData) => string)
    error?: string
    onSuccess?: (data: TData, args: TArgs) => void
  } = {},
) {
  const qc = useQueryClient()
  return useMutation<TData, Error, TArgs>({
    mutationFn,
    onSuccess: (data, args) => {
      if (cfg.invalidate) {
        for (const key of cfg.invalidate) {
          qc.invalidateQueries({ queryKey: key })
        }
      }
      cfg.onSuccess?.(data, args)
      if (cfg.success !== undefined) {
        toast.success(
          typeof cfg.success === "function" ? cfg.success(data) : cfg.success,
        )
      }
    },
    onError: cfg.error
      ? (e) => toast.error(e.message || cfg.error)
      : undefined,
  })
}
