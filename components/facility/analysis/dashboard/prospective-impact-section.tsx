"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Gauge, Percent, Banknote, Users } from "lucide-react"
import {
  computeDealScenarioSavings,
  type ProspectiveImpact,
} from "@/lib/financial-analysis/prospective-impact-model"
import { formatCurrency } from "@/lib/formatting"
import { usdCompact, usdDelta } from "./format"
import { SliderField } from "./slider-field"

const SCENARIO_LABEL: Record<string, string> = {
  conservative: "Conservative",
  expected: "Expected",
  aggressive: "Aggressive",
}

function ImpactCard({
  icon: Icon,
  label,
  value,
  sublabel,
  positive = true,
}: {
  icon: typeof Gauge
  label: string
  value: string
  sublabel: string
  positive?: boolean
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Icon className="h-4 w-4" />
          {label}
        </div>
        <div
          className={`mt-2 text-2xl font-bold tabular-nums ${
            positive ? "text-emerald-600" : ""
          }`}
        >
          {value}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">{sublabel}</div>
      </CardContent>
    </Card>
  )
}

export function ProspectiveImpactSection({
  impact,
  dealBaseSpend,
  scopeNote,
  onSavingsChange,
}: {
  impact: ProspectiveImpact
  /** Spend the deal models against — scoped to the selected categories/vendors. */
  dealBaseSpend: number
  /** One-line note describing the scoped base, e.g. "Modeling on 3 of 8…". */
  scopeNote?: string
  /** Called with an absolute $ savings figure. */
  onSavingsChange: (savings: number) => void
}) {
  // Deal-scenario levers (the facility/buyer lens on the vendor Opportunity
  // Engine, Vick 2026-06-21): model a proposed deal instead of a flat savings %.
  // Levers held as integer percents; the derived saving drives the impact below.
  const [priceChangePct, setPriceChangePct] = useState(-5)
  const [conversionPct, setConversionPct] = useState(50)
  const [volumeGrowthPct, setVolumeGrowthPct] = useState(0)

  const derivedSavings = computeDealScenarioSavings({
    currentVendorSpend: dealBaseSpend,
    priceChangePct: priceChangePct / 100,
    conversionPct: conversionPct / 100,
    volumeGrowthPct: volumeGrowthPct / 100,
  })
  // Push the derived saving up so the impact cards + EV recompute from the deal.
  useEffect(() => {
    onSavingsChange(derivedSavings)
  }, [derivedSavings, onSavingsChange])

  const savingsPctOfBase =
    dealBaseSpend > 0 ? (derivedSavings / dealBaseSpend) * 100 : 0

  return (
    <Card>
      <CardHeader>
        <CardTitle>Prospective Impact Engine</CardTitle>
        <p className="text-sm text-muted-foreground">
          Model a proposed deal — price change, how much spend you convert, and
          expected volume — and see how the resulting saving flows to EBITDA,
          margin, distributable cash flow, and enterprise value.
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Deal Scenario levers */}
        <div className="rounded-lg border p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-col">
              <span className="text-sm font-semibold">Deal Scenario</span>
              {scopeNote ? (
                <span className="text-xs text-muted-foreground">{scopeNote}</span>
              ) : null}
            </div>
            <span className="text-sm font-semibold tabular-nums text-emerald-600">
              {usdCompact(impact.annualSupplySavings)} saving ·{" "}
              {savingsPctOfBase.toFixed(1)}% of scoped spend
            </span>
          </div>
          <div className="grid gap-x-8 gap-y-5 md:grid-cols-3">
            <SliderField
              label="Price change vs current"
              value={priceChangePct}
              min={-25}
              max={5}
              step={1}
              format={(v) => `${v > 0 ? "+" : ""}${v}%`}
              onChange={setPriceChangePct}
            />
            <SliderField
              label="Spend converted to deal"
              value={conversionPct}
              min={0}
              max={100}
              step={5}
              format={(v) => `${v}%`}
              onChange={setConversionPct}
            />
            <SliderField
              label="Expected volume growth"
              value={volumeGrowthPct}
              min={-10}
              max={30}
              step={1}
              format={(v) => `${v > 0 ? "+" : ""}${v}%`}
              onChange={setVolumeGrowthPct}
            />
          </div>
        </div>

        {/* 4 impact cards */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <ImpactCard
            icon={Gauge}
            label="Impact to EBITDA"
            value={usdDelta(impact.impactToEbitda)}
            sublabel={`${usdCompact(
              impact.futureEbitda - impact.impactToEbitda,
            )} → ${usdCompact(impact.futureEbitda)}`}
          />
          <ImpactCard
            icon={Percent}
            label="Impact to Margin %"
            value={`+${impact.impactToMarginPoints.toFixed(2)} pts`}
            sublabel={`→ ${(impact.futureEbitdaMarginPct * 100).toFixed(1)}%`}
          />
          <ImpactCard
            icon={Banknote}
            label="Distributable Cash Flow"
            value={usdDelta(impact.impactToDistributableCashFlow)}
            sublabel="Added to distributable cash flow"
          />
          <ImpactCard
            icon={Users}
            label="$ Impact per Case"
            value={formatCurrency(impact.impactPerCase)}
            sublabel="Spread across annual cases"
            positive={impact.impactPerCase > 0}
          />
        </div>

        {/* Enterprise Value Impact */}
        <div>
          <h3 className="text-sm font-semibold">
            Enterprise Value Impact (EV = EBITDA × Multiple)
          </h3>
          <p className="text-xs text-muted-foreground">
            Each dollar added to EBITDA is worth the multiple in enterprise
            value. Three scenarios.
          </p>
          <div className="mt-3 grid gap-4 sm:grid-cols-3">
            {impact.enterpriseValue.map((ev) => (
              <Card key={ev.scenario}>
                <CardContent className="p-5">
                  <div className="flex items-center justify-between text-sm text-muted-foreground">
                    <span>{SCENARIO_LABEL[ev.scenario] ?? ev.scenario}</span>
                    <span className="font-semibold">{ev.multiple}×</span>
                  </div>
                  <div className="mt-2 text-2xl font-bold tabular-nums text-emerald-600">
                    {usdDelta(ev.incrementalEv)}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground tabular-nums">
                    {usdCompact(ev.currentEv)} → {usdCompact(ev.futureEv)}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
