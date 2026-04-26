"use client"

import {
  Bar,
  BarChart,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts"
import { PieChart as PieChartIcon } from "lucide-react"
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
 * Charles 2026-04-26: parallels the facility-side
 * `CategoryMarketShareCard` UX bandage (commit 42604e1). Previously
 * this widget rendered "No market share data" whenever the action
 * returned an empty list — which silently hid vendors whose COG was
 * present but un-categorized. The action now returns
 * `{ rows, uncategorizedSpend, totalVendorSpend }` so the chart can
 * distinguish three states:
 *  1. No spend at all in COG.
 *  2. Spend exists but ALL un-categorized → tell the user so.
 *  3. Mixed → render the bars + footnote when un-categorized > 5%.
 */

const UNCATEGORIZED_FOOTNOTE_THRESHOLD = 0.05

interface VendorMarketShareChartProps {
  data: {
    rows: { category: string; share: number }[]
    uncategorizedSpend: number
    totalVendorSpend: number
  }
}

export function VendorMarketShareChart({ data }: VendorMarketShareChartProps) {
  const { rows, uncategorizedSpend, totalVendorSpend } = data
  const hasRows = rows.length > 0

  // ─── State 1: no spend at all ─────────────────────────────────
  if (totalVendorSpend === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Your Market Share by Category</CardTitle>
          <CardDescription>
            No spend recorded for this vendor in the last available COG
            window.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center h-[240px] text-muted-foreground">
            <PieChartIcon className="h-12 w-12 mb-4 opacity-50" />
            <p className="text-lg font-medium">No spend data</p>
            <p className="text-sm">
              Once COG is loaded for your contracts, share by category
              will appear here.
            </p>
          </div>
        </CardContent>
      </Card>
    )
  }

  // ─── State 2: spend exists but ALL un-categorized ─────────────
  if (!hasRows) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Your Market Share by Category</CardTitle>
          <CardDescription>
            You have{" "}
            <span className="font-semibold text-foreground">
              {formatCurrency(totalVendorSpend)}
            </span>{" "}
            of spend, but none of the COG records are categorized — so
            we can&apos;t compute share by category. Categorize the COG
            import (or remap items to categories) and this chart will
            populate.
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  // ─── State 3: normal render with optional footnote ────────────
  const uncategorizedRatio =
    totalVendorSpend > 0 ? uncategorizedSpend / totalVendorSpend : 0
  const showFootnote =
    uncategorizedRatio > UNCATEGORIZED_FOOTNOTE_THRESHOLD

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your Market Share by Category</CardTitle>
        <CardDescription>Percentage of total category spend</CardDescription>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={rows} layout="vertical">
            <XAxis
              type="number"
              domain={[0, 100]}
              fontSize={12}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) => `${v}%`}
            />
            <YAxis
              dataKey="category"
              type="category"
              fontSize={12}
              tickLine={false}
              axisLine={false}
              width={100}
            />
            <Tooltip
              contentStyle={chartTooltipStyle}
              formatter={(v) => [`${Number(v).toFixed(1)}%`, "Share"]}
            />
            <Bar
              dataKey="share"
              fill="var(--primary)"
              radius={[0, 4, 4, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
        {showFootnote && (
          <p className="border-t pt-2 mt-2 text-[11px] text-amber-700 dark:text-amber-400">
            Plus {formatCurrency(uncategorizedSpend)} un-categorized (
            {(uncategorizedRatio * 100).toFixed(0)}% of your total) —
            shares above only reflect categorized spend.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
