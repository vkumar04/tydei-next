"use client"

import { Info } from "lucide-react"
import { Slider } from "@/components/ui/slider"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

interface SliderFieldProps {
  label: string
  /** Current numeric value (in display units). */
  value: number
  onChange: (value: number) => void
  min: number
  max: number
  step?: number
  /** Renders the value next to the label, e.g. "30%" or "$41.7M". */
  format: (value: number) => string
  /** Plain-language explanation shown in an info tooltip next to the label. */
  hint?: string
}

/** Labelled slider with a live value read-out — the building block of the
 *  Financial Assumptions, Prospective Impact, and Growth Simulator panels. */
export function SliderField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  format,
  hint,
}: SliderFieldProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span className="flex items-center gap-1 text-muted-foreground">
          {label}
          {hint ? (
            <TooltipProvider>
              <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="text-muted-foreground/70 hover:text-foreground"
                  aria-label={`What is ${label}?`}
                >
                  <Info className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs text-xs leading-relaxed">
                {hint}
              </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : null}
        </span>
        <span className="font-semibold tabular-nums">{format(value)}</span>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={(v) => onChange(v[0] ?? value)}
      />
    </div>
  )
}
