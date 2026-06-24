"use client"

/**
 * Proposals stepper (Vick 2026-06-24): the guided deal flow that collapses the
 * old standalone Deal Scorer + Opportunity Engine tabs into ordered steps —
 *   1. Usage & Pricing  → upload usage (auto-fills constructs) + score the deal
 *   2. Opportunity Engine → facility levers + the exportable report
 * Each step reuses its existing section verbatim; the stepper only owns the
 * step nav. A scored deal flows into step 2 via the existing My-Proposals
 * "Opportunity Engine" handoff (initialDeal).
 */

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { Gauge, Rocket, ChevronLeft, ChevronRight, Check } from "lucide-react"

import { DealScorerSection } from "./DealScorerSection"
import {
  OpportunityEngineSection,
  type OppEngineHandoff,
} from "./OpportunityEngineSection"
import type { VendorProposal } from "@/lib/actions/prospective"

interface FacilityOption {
  id: string
  name: string
}

const STEPS = [
  { key: "deal", label: "Usage & Pricing", icon: Gauge },
  { key: "opportunity", label: "Opportunity & Report", icon: Rocket },
] as const

export function ProposalStepper({
  vendorId,
  facilities,
  proposals,
  initialDeal,
}: {
  vendorId: string
  facilities: FacilityOption[]
  proposals: VendorProposal[]
  /** Optional handoff that jumps straight to step 2 pre-filled. */
  initialDeal?: OppEngineHandoff | null
}) {
  const [step, setStep] = useState(initialDeal ? 1 : 0)
  // The deal analyzed in step 1 auto-seeds step 2 (falls back to an external
  // handoff, e.g. from the My-Proposals "Opportunity Engine" button).
  const [stepDeal, setStepDeal] = useState<OppEngineHandoff | null>(null)
  const opportunityDeal = stepDeal ?? initialDeal ?? null

  return (
    <div className="space-y-5">
      {/* Step indicator */}
      <ol className="flex items-center gap-2">
        {STEPS.map((s, i) => {
          const Icon = s.icon
          const done = i < step
          const active = i === step
          return (
            <li key={s.key} className="flex flex-1 items-center gap-2">
              <button
                type="button"
                onClick={() => setStep(i)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors",
                  active
                    ? "border-primary bg-primary/5 font-medium text-primary"
                    : done
                      ? "border-emerald-300 text-emerald-700 dark:text-emerald-400"
                      : "text-muted-foreground hover:bg-muted/50",
                )}
              >
                <span
                  className={cn(
                    "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs",
                    active
                      ? "bg-primary text-primary-foreground"
                      : done
                        ? "bg-emerald-600 text-white"
                        : "bg-muted",
                  )}
                >
                  {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
                </span>
                <Icon className="h-4 w-4 shrink-0" />
                <span className="truncate">{s.label}</span>
              </button>
            </li>
          )
        })}
      </ol>

      {/* Step body */}
      {step === 0 ? (
        <DealScorerSection
          vendorId={vendorId}
          facilities={facilities}
          proposals={proposals}
          onDealAnalyzed={setStepDeal}
        />
      ) : (
        <OpportunityEngineSection
          vendorId={vendorId}
          facilities={facilities}
          initialDeal={opportunityDeal}
        />
      )}

      {/* Nav */}
      <div className="flex items-center justify-between">
        <Button
          type="button"
          variant="outline"
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0}
        >
          <ChevronLeft className="mr-1 h-4 w-4" /> Back
        </Button>
        <Button
          type="button"
          onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
          disabled={step === STEPS.length - 1}
        >
          {step === 0 ? "Next: Opportunity Engine" : "Next"}
          <ChevronRight className="ml-1 h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
