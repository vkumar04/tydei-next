"use client"

import { useMemo } from "react"
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
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
import { formatCurrency } from "@/lib/formatting"

/**
 * Year-by-year net cashflow from the ROI engine.
 *
 * Visualization choice (2026-04-25): the prior LineChart was nearly
 * unreadable in dark mode because `stroke="hsl(var(--primary))"` doesn't
 * resolve inside Recharts SVG — the line vanished and only the dots
 * showed. Switched to a ComposedChart so:
 *   - Bars per year (red when negative, emerald when positive) make
 *     the inflow/outflow direction obvious at a glance.
 *   - A cumulative cashflow line overlays the bars so the user can
 *     see when the investment breaks even (line crosses $0).
 * All colors are literal hex so they survive Recharts' inline-attr
 * styling.
 */
export interface AnalysisCashflowChartProps {
  /** Cashflow series from computeCapitalROI — index 0 is t=0 (outlay). */
  cashflows: number[]
}

const POSITIVE = "#10b981" // emerald-500
const NEGATIVE = "#ef4444" // red-500
const CUMULATIVE = "#3b82f6" // blue-500
const GRID = "#64748b" // slate-500
const AXIS = "#94a3b8" // slate-400

export function AnalysisCashflowChart({
  cashflows,
}: AnalysisCashflowChartProps) {
  const chartData = useMemo(() => {
    let running = 0
    return cashflows.map((cf, i) => {
      const v = Number.isFinite(cf) ? cf : 0
      running += v
      return {
        year: `Y${i}`,
        netCashflow: v,
        cumulative: running,
      }
    })
  }, [cashflows])

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Yearly net cashflow</CardTitle>
        <CardDescription>
          Year 0 = initial outlay. Years 1-N combine rebates, tax savings, and
          price-lock opportunity cost. Blue line = cumulative; bars = annual
          net.
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
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart
              data={chartData}
              margin={{ top: 8, right: 16, left: 8, bottom: 8 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke={GRID}
                strokeOpacity={0.35}
              />
              <XAxis
                dataKey="year"
                tick={{ fontSize: 11, fill: AXIS }}
                stroke={GRID}
              />
              <YAxis
                tick={{ fontSize: 11, fill: AXIS }}
                tickFormatter={(v: number) => formatCurrency(v)}
                stroke={GRID}
                width={80}
              />
              <ReferenceLine y={0} stroke={AXIS} strokeOpacity={0.6} />
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
                itemStyle={{ color: "#e2e8f0", padding: "2px 0" }}
                cursor={{ fill: "#94a3b8", fillOpacity: 0.1 }}
                formatter={(v) => formatCurrency(Number(v))}
              />
              <Legend
                wrapperStyle={{ fontSize: 12, color: AXIS }}
                iconType="circle"
              />
              <Bar
                dataKey="netCashflow"
                name="Annual net"
                radius={[3, 3, 0, 0]}
              >
                {chartData.map((d, i) => (
                  <Cell
                    key={i}
                    fill={d.netCashflow >= 0 ? POSITIVE : NEGATIVE}
                  />
                ))}
              </Bar>
              <Line
                type="monotone"
                dataKey="cumulative"
                name="Cumulative"
                stroke={CUMULATIVE}
                strokeWidth={2.5}
                dot={{ r: 3, fill: CUMULATIVE, strokeWidth: 0 }}
                activeDot={{ r: 5 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  )
}
