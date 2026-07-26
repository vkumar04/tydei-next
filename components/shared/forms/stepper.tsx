import { Check } from "lucide-react"

import { cn } from "@/lib/utils"

interface StepperProps {
  /** 1-based index of the active step. */
  current: number
  steps: string[]
}

/**
 * Minimal numbered progress header for multi-step dialogs.
 *
 * Presentational only — the parent owns which step is active and whether it is
 * allowed to advance, so this can't get out of sync with validation.
 */
export function Stepper({ current, steps }: StepperProps) {
  return (
    <ol className="flex items-center gap-2" aria-label="Progress">
      {steps.map((label, i) => {
        const index = i + 1
        const isDone = index < current
        const isActive = index === current
        return (
          <li key={label} className="flex flex-1 items-center gap-2">
            <span
              aria-current={isActive ? "step" : undefined}
              className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
                isDone && "border-primary bg-primary text-primary-foreground",
                isActive && "border-primary text-primary",
                !isDone && !isActive && "border-border text-muted-foreground",
              )}
            >
              {isDone ? <Check className="size-3" /> : index}
            </span>
            <span
              className={cn(
                "truncate text-sm",
                isActive ? "font-medium text-foreground" : "text-muted-foreground",
              )}
            >
              {label}
            </span>
            {index < steps.length && (
              <span
                aria-hidden
                className={cn(
                  "h-px flex-1",
                  isDone ? "bg-primary" : "bg-border",
                )}
              />
            )}
          </li>
        )
      })}
    </ol>
  )
}
