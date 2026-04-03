"use client"

import { useMemo } from "react"
import {
  AreaChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts"
import { ChartCard } from "@/components/shared/charts/chart-card"
import { chartTooltipStyle } from "@/lib/chart-config"
import { formatCurrency } from "@/lib/formatting"
import type { ForecastResult } from "@/lib/actions/forecasting"

interface ForecastChartProps {
  result: ForecastResult
  title?: string
  description?: string
}

export function ForecastChart({
  result,
  title = "Spend Forecast",
  description = "Actual vs. forecast with confidence interval",
}: ForecastChartProps) {
  const { chartData, boundaryPeriod } = useMemo(() => {
    if (!result.data.length) return { chartData: [], boundaryPeriod: null }

    // Find the last period that has an actual value — that is the boundary
    let boundaryPeriod: string | null = null
    for (let i = result.data.length - 1; i >= 0; i--) {
      if (result.data[i].actual != null) {
        boundaryPeriod = result.data[i].period
        break
      }
    }

    const chartData = result.data.map((point) => ({
      period: point.period,
      actual: point.actual,
      forecast: point.forecast,
      lower: point.lower,
      upper: point.upper,
      // For the shaded confidence band, Recharts Area needs a [lower, upper] range
      confidence: point.lower != null && point.upper != null ? [point.lower, point.upper] : null,
    }))

    return { chartData, boundaryPeriod }
  }, [result.data])

  if (!chartData.length) {
    return (
      <ChartCard title={title} description={description}>
        <div className="flex h-[280px] items-center justify-center">
          <p className="text-sm text-muted-foreground">
            Not enough data to display forecast chart.
          </p>
        </div>
      </ChartCard>
    )
  }

  return (
    <ChartCard title={title} description={description}>
      <ResponsiveContainer width="100%" height={320}>
        <AreaChart
          data={chartData}
          margin={{ top: 5, right: 20, left: 10, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
          <XAxis
            dataKey="period"
            tick={{ fontSize: 11 }}
            className="fill-muted-foreground"
          />
          <YAxis
            tickFormatter={(v: number) =>
              `$${(v / 1000).toFixed(0)}k`
            }
            className="fill-muted-foreground"
            tick={{ fontSize: 11 }}
          />
          <Tooltip
            formatter={(value, name) => {
              if (Array.isArray(value)) {
                return [
                  `${formatCurrency(Number(value[0]))} – ${formatCurrency(Number(value[1]))}`,
                  "Confidence",
                ]
              }
              return [formatCurrency(Number(value)), name]
            }}
            contentStyle={chartTooltipStyle}
          />

          {/* Confidence band — shaded area between lower and upper */}
          <Area
            type="monotone"
            dataKey="confidence"
            name="Confidence"
            stroke="none"
            fill="var(--primary)"
            fillOpacity={0.1}
            activeDot={false}
            isAnimationActive={false}
          />

          {/* Actual values — solid line */}
          <Line
            type="monotone"
            dataKey="actual"
            name="Actual"
            stroke="var(--chart-1)"
            strokeWidth={2}
            dot={false}
            connectNulls={false}
          />

          {/* Forecast values — dashed line */}
          <Line
            type="monotone"
            dataKey="forecast"
            name="Forecast"
            stroke="var(--primary)"
            strokeWidth={2}
            strokeDasharray="6 3"
            dot={false}
            connectNulls={false}
          />

          {/* Vertical reference line between actual and forecast */}
          {boundaryPeriod && (
            <ReferenceLine
              x={boundaryPeriod}
              stroke="var(--muted-foreground)"
              strokeDasharray="3 3"
              label={{
                value: "Now",
                position: "top",
                fill: "var(--muted-foreground)",
                fontSize: 11,
              }}
            />
          )}
        </AreaChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}
