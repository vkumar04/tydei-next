"use client"

/**
 * Case Costing — Financial tab.
 *
 * Per docs/superpowers/specs/2026-04-18-case-costing-rewrite.md §4 (subsystem 3).
 * Surfaces:
 *   - Facility baseline averages (avg case cost / reimb / margin %)
 *   - A per-surgeon margin-percent comparison bar chart
 *
 * Data comes from the orchestrator via the `FacilityAverages` + `Surgeon[]`
 * props; chart is recharts.
 */

import { useMemo } from "react"
import {
  BarChart,
  Bar,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/shared/empty-state"
import { TrendingUp } from "lucide-react"
import { formatCurrency, formatPercent } from "@/lib/formatting"
import { chartTooltipStyle } from "@/lib/chart-config"
import type { FacilityAverages } from "@/lib/case-costing/facility-averages"
import type { Surgeon } from "@/lib/case-costing/surgeon-derivation"

interface FinancialTabProps {
  averages: FacilityAverages | null
  scorecards: Surgeon[]
  isLoading: boolean
}

export function FinancialTab({
  averages,
  scorecards,
  isLoading,
}: FinancialTabProps) {
  const chartData = useMemo(() => {
    // Top-10 surgeons by case volume so the chart stays legible.
    return [...scorecards]
      .filter((s) => s.totalReimbursement > 0)
      .sort((a, b) => b.caseCount - a.caseCount)
      .slice(0, 10)
      .map((s) => ({
        surgeon: shortenName(s.name),
        marginPct: Number(s.avgMarginPct.toFixed(1)),
        avgSpend: Math.round(s.avgSpendPerCase),
      }))
  }, [scorecards])

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-[320px] w-full" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Facility averages</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-4">
            <Stat
              label="Avg case cost"
              value={formatCurrency(averages?.avgCaseCost ?? 0)}
            />
            <Stat
              label="Avg reimbursement"
              value={formatCurrency(averages?.avgReimbursementPerCase ?? 0)}
            />
            <Stat
              label="Avg margin %"
              value={
                averages && averages.avgReimbursementPerCase > 0
                  ? formatPercent(averages.avgMarginPct)
                  : "—"
              }
              tone={
                averages?.avgMarginPct !== undefined
                  ? averages.avgMarginPct >= 30
                    ? "positive"
                    : averages.avgMarginPct > 0
                      ? "warn"
                      : "muted"
                  : "muted"
              }
            />
            <Stat
              label="Avg OR time"
              value={
                averages?.avgTimeInOrMinutes
                  ? `${Math.round(averages.avgTimeInOrMinutes)} min`
                  : "—"
              }
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Margin % by surgeon (top 10 by volume)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {chartData.length === 0 ? (
            <EmptyState
              icon={TrendingUp}
              title="Not enough data"
              description="Margin trends require cases with reimbursement data."
            />
          ) : (
            <ResponsiveContainer width="100%" height={320}>
              <BarChart
                data={chartData}
                margin={{ top: 10, right: 20, left: 10, bottom: 10 }}
              >
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis
                  dataKey="surgeon"
                  tick={{ fontSize: 11 }}
                  interval={0}
                  angle={-25}
                  textAnchor="end"
                  height={60}
                />
                <YAxis
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v: number) => `${v}%`}
                />
                <Tooltip
                  formatter={(value) => {
                    const n =
                      typeof value === "number" ? value : Number(value ?? 0)
                    return [`${n.toFixed(1)}%`, "Margin %"]
                  }}
                  contentStyle={chartTooltipStyle}
                />
                {averages &&
                  averages.avgReimbursementPerCase > 0 && (
                    <ReferenceLine
                      y={Number(averages.avgMarginPct.toFixed(1))}
                      stroke="var(--muted-foreground)"
                      strokeDasharray="4 2"
                      label={{
                        value: `Facility avg ${averages.avgMarginPct.toFixed(1)}%`,
                        position: "insideTopRight",
                        fill: "var(--muted-foreground)",
                        fontSize: 10,
                      }}
                    />
                  )}
                <Bar dataKey="marginPct" fill="var(--chart-1)" radius={4} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

interface StatProps {
  label: string
  value: string
  tone?: "positive" | "warn" | "muted"
}

function Stat({ label, value, tone }: StatProps) {
  const toneClass =
    tone === "positive"
      ? "text-green-600 dark:text-green-400"
      : tone === "warn"
        ? "text-amber-600 dark:text-amber-400"
        : tone === "muted"
          ? "text-muted-foreground"
          : ""
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-lg font-bold tabular-nums ${toneClass}`}>{value}</p>
    </div>
  )
}

function shortenName(name: string): string {
  if (name.length <= 16) return name
  return `${name.slice(0, 15)}…`
}
