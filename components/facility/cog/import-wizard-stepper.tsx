"use client"

/**
 * Visual stepper shown at the top of the COG import dialog.
 *
 * Mirrors the four conceptual stages of the wizard described in the
 * COG data rewrite spec (2026-04-18-cog-data-rewrite.md §3):
 *
 *   1. Upload CSV  2. Preview + dedup  3. Confirm  4. Success
 *
 * This component is purely presentational — it reads the current
 * dialog step and highlights the matching visual stage. Actual step
 * transitions are owned by `useCOGImport` / `COGImportDialog`.
 */

import { Check } from "lucide-react"
import { cn } from "@/lib/utils"

export type ImportWizardStage = "upload" | "preview" | "confirm" | "success"

interface ImportWizardStepperProps {
  /** Which logical stage the wizard is currently on. */
  stage: ImportWizardStage
}

interface StepDef {
  id: ImportWizardStage
  label: string
  description: string
}

const STEPS: readonly StepDef[] = [
  {
    id: "upload",
    label: "Upload",
    description: "Select your CSV or XLSX",
  },
  {
    id: "preview",
    label: "Preview & Dedup",
    description: "Review rows and duplicates",
  },
  {
    id: "confirm",
    label: "Confirm",
    description: "Choose strategy and import",
  },
  {
    id: "success",
    label: "Summary",
    description: "Review import results",
  },
] as const

const stageIndex = (stage: ImportWizardStage): number =>
  STEPS.findIndex((s) => s.id === stage)

export function ImportWizardStepper({ stage }: ImportWizardStepperProps) {
  const currentIdx = stageIndex(stage)

  return (
    <nav aria-label="Import progress" className="w-full">
      <ol className="flex w-full items-start gap-2">
        {STEPS.map((step, idx) => {
          const isComplete = idx < currentIdx
          const isCurrent = idx === currentIdx
          const isLast = idx === STEPS.length - 1

          return (
            <li key={step.id} className="flex flex-1 items-start gap-2">
              <div className="flex flex-1 flex-col items-center text-center">
                <div className="flex w-full items-center">
                  <div
                    className={cn(
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 text-xs font-semibold transition-colors",
                      isComplete &&
                        "border-primary bg-primary text-primary-foreground",
                      isCurrent &&
                        "border-primary bg-background text-primary",
                      !isComplete &&
                        !isCurrent &&
                        "border-muted-foreground/30 bg-background text-muted-foreground"
                    )}
                    aria-current={isCurrent ? "step" : undefined}
                  >
                    {isComplete ? (
                      <Check className="h-4 w-4" />
                    ) : (
                      idx + 1
                    )}
                  </div>

                  {!isLast && (
                    <div
                      className={cn(
                        "ml-2 h-0.5 flex-1 transition-colors",
                        idx < currentIdx
                          ? "bg-primary"
                          : "bg-muted-foreground/20"
                      )}
                    />
                  )}
                </div>
                <div className="mt-2 px-1">
                  <p
                    className={cn(
                      "text-xs font-medium",
                      (isComplete || isCurrent)
                        ? "text-foreground"
                        : "text-muted-foreground"
                    )}
                  >
                    {step.label}
                  </p>
                  <p className="hidden text-[11px] text-muted-foreground sm:block">
                    {step.description}
                  </p>
                </div>
              </div>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
