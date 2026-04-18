"use client"

import { useMemo } from "react"
import {
  CartesianGrid,
  Line,
  LineChart,
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

/**
 * Renders the year-by-year net cashflow series from the ROI engine as
 * a recharts LineChart. Year 0 (initial outlay) is included so the user
 * can see the upfront basis.
 */
export interface AnalysisCashflowChartProps {
  /** Cashflow series from computeCapitalROI — index 0 is t=0 (outlay). */
  cashflows: number[]
}

export function AnalysisCashflowChart({
  cashflows,
}: AnalysisCashflowChartProps) {
  const chartData = useMemo(
    () =>
      cashflows.map((cf, i) => ({
        year: `Y${i}`,
        netCashflow: Number.isFinite(cf) ? cf : 0,
      })),
    [cashflows],
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Yearly net cashflow</CardTitle>
        <CardDescription>
          Year 0 = initial outlay. Years 1-N combine rebates, tax savings, and
          price-lock opportunity cost.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {chartData.length === 0 ? (
          <div className="flex h-[260px] items-center justify-center">
            <p className="text-sm text-muted-foreground">
              No cashflow data to display.
            </p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <LineChart
              data={chartData}
              margin={{ top: 8, right: 16, left: 8, bottom: 8 }}
            >
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis
                dataKey="year"
                tick={{ fontSize: 11 }}
                className="fill-muted-foreground"
              />
              <YAxis
                tick={{ fontSize: 11 }}
                tickFormatter={(v: number) => formatCurrency(v)}
                className="fill-muted-foreground"
                width={80}
              />
              <ReferenceLine y={0} stroke="currentColor" strokeOpacity={0.3} />
              <Tooltip
                contentStyle={chartTooltipStyle}
                formatter={(v) => formatCurrency(Number(v))}
              />
              <Line
                type="monotone"
                dataKey="netCashflow"
                name="Net cashflow"
                stroke="hsl(var(--primary))"
                strokeWidth={2}
                dot={{ r: 3 }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  )
}
