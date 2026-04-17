import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from "recharts"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatCurrency, formatPercent } from "@/lib/formatting"
import { CHART_COLORS, chartTooltipStyle } from "@/lib/chart-config"
import { TrendIcon } from "./trend-icon"
import type { CategoryRow, MarketShareStats } from "./types"

interface Props {
  categoryRows: CategoryRow[]
  stats: MarketShareStats
  mergedCount: number
}

export function CategoryTableSection({ categoryRows, stats, mergedCount }: Props) {
  const pieData = categoryRows.map((r) => ({ name: r.category, value: r.yourSpend }))

  return (
    <div className="grid gap-4 lg:grid-cols-5">
      {/* Pie Chart */}
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Spend by Category</CardTitle>
          <CardDescription>Your vendor spend distribution</CardDescription>
        </CardHeader>
        <CardContent>
          {pieData.length === 0 ? (
            <p className="text-center py-8 text-muted-foreground">No data</p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={pieData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={90}
                  paddingAngle={2}
                  label={({ name, percent }: { name?: string; percent?: number }) => {
                    const label = name ?? ""
                    const pct = percent ?? 0
                    return `${label.length > 12 ? label.slice(0, 12) + "..." : label}: ${(pct * 100).toFixed(0)}%`
                  }}
                >
                  {pieData.map((_, i) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={chartTooltipStyle} formatter={(v) => formatCurrency(Number(v))} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Category Table */}
      <Card className="lg:col-span-3">
        <CardHeader>
          <CardTitle>Market Share by Product Category</CardTitle>
          <CardDescription>
            Your spend vs total market across product categories
            {mergedCount > 0 && (
              <Badge variant="secondary" className="ml-2">
                {mergedCount} merged
              </Badge>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Your Spend</TableHead>
                <TableHead className="text-right">Total Market</TableHead>
                <TableHead className="text-right">Share %</TableHead>
                <TableHead className="text-center">Trend</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {categoryRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                    No category data available for the selected period
                  </TableCell>
                </TableRow>
              ) : (
                categoryRows.map((row) => (
                  <TableRow key={row.category}>
                    <TableCell className="font-medium">{row.category}</TableCell>
                    <TableCell className="text-right">{formatCurrency(row.yourSpend)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(row.totalMarket)}</TableCell>
                    <TableCell className="text-right">
                      <Badge
                        variant={
                          row.sharePct >= 40 ? "default" : row.sharePct >= 20 ? "secondary" : "outline"
                        }
                      >
                        {formatPercent(row.sharePct)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center">
                        <TrendIcon trend={row.trend} />
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          {categoryRows.length > 0 && (
            <div className="mt-4 pt-4 border-t flex items-center justify-between text-sm text-muted-foreground">
              <span>
                {categoryRows.length} categories | Vendor spend: {formatCurrency(stats.totalVendorSpend)}
              </span>
              <span>
                Market: {formatCurrency(stats.totalMarketSpend)} | Share: {stats.overallSharePct}%
              </span>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
