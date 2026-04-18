"use client"

/**
 * Sensitivity Chart — rebate vs spend curve.
 *
 * Visualises how the rebate amount responds to varying spend levels for
 * a single opportunity. Tier thresholds render as reference lines so the
 * step-up at each breakpoint is obvious. The active scenario (if any) is
 * highlighted with a reference dot + line so the user can read their
 * scenario off the curve.
 */

import { useMemo } from "react"
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { chartTooltipStyle } from "@/lib/chart-config"
import { formatCurrency } from "@/lib/formatting"
import type { RebateOpportunity } from "@/lib/actions/rebate-optimizer-engine"
import { buildSensitivitySeries, type ScenarioEvaluation } from "./scenario-math"
import { TrendingUp } from "lucide-react"
import { EmptyState } from "@/components/shared/empty-state"

interface SensitivityChartProps {
  opportunity: RebateOpportunity | null
  activeEvaluation: ScenarioEvaluation | null
}

export function SensitivityChart({
  opportunity,
  activeEvaluation,
}: SensitivityChartProps) {
  const data = useMemo(
    () => (opportunity ? buildSensitivitySeries(opportunity) : []),
    [opportunity],
  )

  if (!opportunity) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Sensitivity Analysis</CardTitle>
          <CardDescription>
            Rebate yield across the projected spend range, with tier breakpoints
            highlighted.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <EmptyState
            icon={TrendingUp}
            title="No opportunity selected"
            description="Pick a contract in the scenario builder to see its rebate curve."
          />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sensitivity Analysis</CardTitle>
        <CardDescription>
          {opportunity.vendorName} — {opportunity.contractName}. Rebate as a
          function of spend across the current tier range. Reference lines mark
          tier breakpoints.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-[320px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={data}
              margin={{ top: 10, right: 24, bottom: 0, left: 8 }}
            >
              <defs>
                <linearGradient id="rebateGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.6} />
                  <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0.05} />
                </linearGradient>
              </defs>

              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />

              <XAxis
                dataKey="spend"
                type="number"
                domain={[0, "dataMax"]}
                tickFormatter={(v: number) => `$${Math.round(v / 1000)}k`}
                tick={{ fontSize: 11 }}
                className="fill-muted-foreground"
              />
              <YAxis
                tickFormatter={(v: number) => `$${Math.round(v / 1000)}k`}
                tick={{ fontSize: 11 }}
                className="fill-muted-foreground"
              />
              <Tooltip
                formatter={(value, name) => {
                  const label = name === "rebate" ? "Rebate" : String(name ?? "")
                  return [formatCurrency(Number(value ?? 0)), label]
                }}
                labelFormatter={(label) =>
                  `Spend: ${formatCurrency(Number(label ?? 0))}`
                }
                contentStyle={chartTooltipStyle}
              />

              {/* Tier breakpoints */}
              <ReferenceLine
                x={opportunity.currentSpend}
                stroke="var(--muted-foreground)"
                strokeDasharray="2 4"
                label={{
                  value: "Current spend",
                  position: "insideTopLeft",
                  fill: "var(--muted-foreground)",
                  fontSize: 10,
                }}
              />
              <ReferenceLine
                x={opportunity.nextTierThreshold}
                stroke="var(--chart-2)"
                strokeDasharray="4 4"
                label={{
                  value: `Tier ${opportunity.nextTierNumber}`,
                  position: "insideTopRight",
                  fill: "var(--chart-2)",
                  fontSize: 10,
                }}
              />

              <Area
                type="monotone"
                dataKey="rebate"
                stroke="var(--chart-1)"
                fill="url(#rebateGradient)"
                strokeWidth={2}
                isAnimationActive={false}
              />

              {/* Scenario marker */}
              {activeEvaluation && activeEvaluation.projectedSpend > 0 && (
                <ReferenceDot
                  x={activeEvaluation.projectedSpend}
                  y={activeEvaluation.projectedRebate}
                  r={6}
                  fill="var(--chart-3)"
                  stroke="var(--background)"
                  strokeWidth={2}
                  ifOverflow="extendDomain"
                />
              )}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}
