"use client"

import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import {
  AreaChart,
  Area,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
  ReferenceLine,
} from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { queryKeys } from "@/lib/query-keys"
import { getRebateForecast } from "@/lib/actions/analytics/rebate-forecast"

const fmtUsd = (n: number) =>
  `$${Math.round(n).toLocaleString("en-US")}`

export function RebateForecastCard({
  contractId,
  forecastMonths = 12,
  initialData,
}: {
  contractId: string
  forecastMonths?: number
  initialData?: Awaited<ReturnType<typeof getRebateForecast>>
}) {
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.analytics.rebateForecast(contractId, forecastMonths),
    queryFn: () => getRebateForecast(contractId, forecastMonths),
    initialData,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
  })

  const series = useMemo(() => {
    if (!data) return []
    return [
      ...data.history.map((p) => ({
        period: p.period,
        actual: p.rebateForPeriod,
        forecast: null as number | null,
      })),
      ...data.forecast.map((p) => ({
        period: p.period,
        actual: null as number | null,
        forecast: p.rebateForPeriod,
      })),
    ]
  }, [data])

  const lastHistoryPeriod =
    data?.history[data.history.length - 1]?.period ?? null

  const trendBadge = (() => {
    if (!data) return null
    if (data.trend === "increasing")
      return <Badge variant="default">↑ Increasing</Badge>
    if (data.trend === "decreasing")
      return <Badge variant="destructive">↓ Decreasing</Badge>
    return <Badge variant="secondary">Stable</Badge>
  })()

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Rebate Forecast (next {forecastMonths} mo)</CardTitle>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {data ? (
              <>
                <span>
                  Growth {data.growthRatePct > 0 ? "+" : ""}
                  {data.growthRatePct}% / yr
                </span>
                <span>•</span>
                <span>Confidence {data.confidencePct}%</span>
              </>
            ) : null}
            {trendBadge}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading || !data ? (
          <Skeleton className="h-64 w-full" />
        ) : series.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            Not enough spend history to forecast (need 3+ months).
          </p>
        ) : (
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={series}>
                {/* Recharts SVG attrs don't resolve hsl(var(--*)) tokens
                    (the project's --primary is oklch, so wrapping it in
                    hsl(...) emits invalid CSS and the chart renders
                    invisible). Sticking to literal slate/blue hex like
                    the cashflow + score cards to keep dark-mode legibility. */}
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="#64748b"
                  strokeOpacity={0.35}
                />
                <XAxis
                  dataKey="period"
                  tick={{ fontSize: 11, fill: "#94a3b8" }}
                  stroke="#64748b"
                />
                <YAxis
                  tick={{ fontSize: 11, fill: "#94a3b8" }}
                  tickFormatter={fmtUsd}
                  stroke="#64748b"
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#0f172a",
                    border: "1px solid #334155",
                    borderRadius: 8,
                    fontSize: 12,
                    padding: "8px 12px",
                  }}
                  labelStyle={{
                    color: "#e2e8f0",
                    fontWeight: 600,
                    marginBottom: 4,
                  }}
                  itemStyle={{ color: "#e2e8f0" }}
                  formatter={(value) =>
                    value == null || typeof value !== "number"
                      ? "—"
                      : fmtUsd(value)
                  }
                />
                <Legend wrapperStyle={{ fontSize: 12, color: "#94a3b8" }} />
                {lastHistoryPeriod ? (
                  <ReferenceLine
                    x={lastHistoryPeriod}
                    stroke="#94a3b8"
                    strokeOpacity={0.6}
                    strokeDasharray="4 2"
                    label={{
                      value: "Today",
                      fontSize: 10,
                      fill: "#94a3b8",
                    }}
                  />
                ) : null}
                <Area
                  type="monotone"
                  dataKey="actual"
                  name="Actual rebate"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  fill="#3b82f6"
                  fillOpacity={0.4}
                  connectNulls
                />
                <Area
                  type="monotone"
                  dataKey="forecast"
                  name="Forecast rebate"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  fill="#3b82f6"
                  fillOpacity={0.15}
                  strokeDasharray="4 4"
                  connectNulls
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
