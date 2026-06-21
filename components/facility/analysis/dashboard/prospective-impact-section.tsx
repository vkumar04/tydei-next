"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Slider } from "@/components/ui/slider"
import { Gauge, Percent, Banknote, Users } from "lucide-react"
import type { ProspectiveImpact } from "@/lib/financial-analysis/prospective-impact-model"
import { formatCurrency } from "@/lib/formatting"
import { usdCompact, usdDelta } from "./format"

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
  currentVendorSpend,
  onSavingsChange,
}: {
  impact: ProspectiveImpact
  currentVendorSpend: number
  /** Called with an absolute $ savings figure. */
  onSavingsChange: (savings: number) => void
}) {
  const savingsPctOfSpend = impact.savingsPctOfSpend * 100

  return (
    <Card>
      <CardHeader>
        <CardTitle>Prospective Impact Engine</CardTitle>
        <p className="text-sm text-muted-foreground">
          Model how a negotiated annual supply saving flows to EBITDA, margin,
          distributable cash flow, and enterprise value.
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Savings slider */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              Negotiated annual supply savings
            </span>
            <span className="font-semibold tabular-nums">
              {usdCompact(impact.annualSupplySavings)} ·{" "}
              {savingsPctOfSpend.toFixed(1)}% of spend
            </span>
          </div>
          <Slider
            value={[savingsPctOfSpend]}
            min={0}
            max={25}
            step={0.1}
            onValueChange={(v) =>
              onSavingsChange(((v[0] ?? 0) / 100) * currentVendorSpend)
            }
          />
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
