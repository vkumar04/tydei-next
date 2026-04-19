"use client"

/**
 * Renewal prep checklist — persistent task list for a single contract's
 * renewal drawer (plan 2026-04-19 §W1.6).
 *
 * Loads the 5-task merged view via `getRenewalTasks`, mutating via
 * `toggleRenewalTask`. Persisted rows override the auto-complete
 * fallback computed from `commitmentMet`. Completed tasks show an
 * audit line with the completer's name and relative time.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { formatDistanceToNow } from "date-fns"
import { Checkbox } from "@/components/ui/checkbox"
import { Skeleton } from "@/components/ui/skeleton"
import { toast } from "sonner"
import {
  getRenewalTasks,
  toggleRenewalTask,
  type RenewalTaskItem,
} from "@/lib/actions/renewals/tasks"

interface RenewalTaskChecklistProps {
  contractId: string
  /** 0-100+; feeds the auto-complete fallback on un-persisted tasks. */
  commitmentMet: number
}

const tasksQueryKey = (contractId: string) =>
  ["renewals", "tasks", contractId] as const

export function RenewalTaskChecklist({
  contractId,
  commitmentMet,
}: RenewalTaskChecklistProps) {
  const qc = useQueryClient()

  const { data, isLoading, isError } = useQuery({
    queryKey: tasksQueryKey(contractId),
    queryFn: () => getRenewalTasks(contractId, commitmentMet),
    enabled: contractId.length > 0,
  })

  const toggleMutation = useMutation({
    mutationFn: (args: { taskKey: string; completed: boolean }) =>
      toggleRenewalTask({
        contractId,
        taskKey: args.taskKey,
        completed: args.completed,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: tasksQueryKey(contractId) })
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Failed to update task"
      toast.error(msg)
    },
  })

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-6 w-full" />
        ))}
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
        Failed to load renewal tasks.
      </div>
    )
  }

  return (
    <ul className="space-y-2">
      {data.map((t: RenewalTaskItem) => {
        const inputId = `renewal-task-${contractId}-${t.key}`
        return (
          <li key={t.key} className="flex items-start gap-2 text-sm">
            <Checkbox
              id={inputId}
              checked={t.completed}
              disabled={toggleMutation.isPending}
              onCheckedChange={(next) => {
                toggleMutation.mutate({
                  taskKey: t.key,
                  completed: next === true,
                })
              }}
              className="mt-0.5"
            />
            <div className="min-w-0 flex-1">
              <label
                htmlFor={inputId}
                className={
                  t.completed
                    ? "cursor-pointer text-muted-foreground line-through"
                    : "cursor-pointer"
                }
              >
                {t.task}
              </label>
              {t.completed && t.completedAt ? (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Completed{" "}
                  {formatDistanceToNow(new Date(t.completedAt), {
                    addSuffix: true,
                  })}
                  {t.completedByName ? ` by ${t.completedByName}` : ""}
                </p>
              ) : null}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
