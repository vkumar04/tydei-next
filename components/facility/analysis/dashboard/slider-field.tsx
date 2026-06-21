"use client"

import { Slider } from "@/components/ui/slider"

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
}: SliderFieldProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
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
