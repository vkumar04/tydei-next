"use client"

import { useMemo, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Wand2 } from "lucide-react"
import {
  computeGrowthSimulation,
  ZERO_GROWTH_LEVERS,
  type GrowthLevers,
} from "@/lib/financial-analysis/growth-simulator"
import type { FacilityModelAssumptions } from "@/lib/financial-analysis/prospective-impact-model"
import { usdCompact, usdDelta } from "./format"
import { SliderField } from "./slider-field"

export function GrowthSimulatorCard({
  assumptions,
}: {
  assumptions: FacilityModelAssumptions
}) {
  const [levers, setLevers] = useState<GrowthLevers>(ZERO_GROWTH_LEVERS)

  const result = useMemo(
    () => computeGrowthSimulation(assumptions, levers),
    [assumptions, levers],
  )

  const set = <K extends keyof GrowthLevers>(key: K, value: number) =>
    setLevers((prev) => ({ ...prev, [key]: value }))

  const pct = (v: number) => `${(v * 100).toFixed(0)}%`

  const outputs: Array<{ label: string; value: string; delta: string }> = [
    {
      label: "EBITDA",
      value: usdCompact(result.simulated.ebitda),
      delta: usdDelta(result.delta.ebitda),
    },
    {
      label: "Margin",
      value: `${(result.simulated.ebitdaMarginPct * 100).toFixed(1)}%`,
      delta: `${result.delta.ebitdaMarginPoints >= 0 ? "+" : ""}${result.delta.ebitdaMarginPoints.toFixed(2)} pts`,
    },
    {
      label: "DCF",
      value: usdCompact(result.simulated.dcf),
      delta: usdDelta(result.delta.dcf),
    },
    {
      label: "Enterprise Value (12×)",
      value: usdCompact(result.simulated.ev),
      delta: usdDelta(result.delta.ev),
    },
  ]

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Wand2 className="h-4 w-4" />
          AI Growth Simulator
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          A &quot;what-if&quot; engine — adjust the growth levers and watch
          EBITDA, DCF, EV, and margin move in real time.
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-x-8 gap-y-5 md:grid-cols-2 lg:grid-cols-3">
          <SliderField
            label="Case volume growth"
            value={levers.volumeGrowthPct}
            min={-0.1}
            max={0.5}
            step={0.01}
            format={pct}
            onChange={(v) => set("volumeGrowthPct", v)}
          />
          <SliderField
            label="Payer-mix lift"
            value={levers.payerMixLiftPct}
            min={0}
            max={0.25}
            step={0.005}
            format={pct}
            onChange={(v) => set("payerMixLiftPct", v)}
          />
          <SliderField
            label="Vendor-share consolidation"
            value={levers.vendorShareConsolidationPct}
            min={0}
            max={0.2}
            step={0.005}
            format={pct}
            onChange={(v) => set("vendorShareConsolidationPct", v)}
          />
          <SliderField
            label="Robotics throughput"
            value={levers.roboticsThroughputPct}
            min={0}
            max={0.3}
            step={0.01}
            format={pct}
            onChange={(v) => set("roboticsThroughputPct", v)}
          />
          <SliderField
            label="New-surgeon revenue"
            value={levers.newSurgeonRevenuePct}
            min={0}
            max={0.3}
            step={0.01}
            format={pct}
            onChange={(v) => set("newSurgeonRevenuePct", v)}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {outputs.map((o) => (
            <Card key={o.label}>
              <CardContent className="p-5">
                <div className="text-sm text-muted-foreground">{o.label}</div>
                <div className="mt-2 text-2xl font-bold tabular-nums">
                  {o.value}
                </div>
                <div className="mt-1 text-xs font-medium text-emerald-600 tabular-nums">
                  {o.delta}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
