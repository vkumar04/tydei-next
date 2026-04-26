"use client"

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  formatPerfCurrency,
  type CategoryBreakdownRow,
} from "./performance-types"

export interface PerformanceCategoriesTabProps {
  categories: CategoryBreakdownRow[]
  isLoading?: boolean
}

export function PerformanceCategoriesTab({
  categories,
  isLoading,
}: PerformanceCategoriesTabProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Performance by Category</CardTitle>
        <CardDescription>
          Trailing 12-month vendor-scoped COG spend by category, with the
          prior 12 months as the baseline. Same source as your dashboard
          market-share card (cOGRecord, vendorId-filtered).
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex h-[300px] items-center justify-center text-sm text-muted-foreground">
            Loading category breakdown…
          </div>
        ) : categories.length === 0 ? (
          <div className="flex h-[200px] flex-col items-center justify-center gap-1 px-6 text-center">
            <p className="text-sm font-medium">
              No categorized spend in the last 24 months
            </p>
            <p className="text-xs text-muted-foreground">
              Once your COG transactions are ingested with a category,
              this card will rank your top categories and compare each
              against the prior 12-month window.
            </p>
          </div>
        ) : (
          <>
            <div className="h-[300px] mb-6">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={categories} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis
                    type="number"
                    tickFormatter={(v) => formatPerfCurrency(v)}
                    tick={{ fill: "var(--muted-foreground)" }}
                    axisLine={{ stroke: "var(--border)" }}
                    tickLine={{ stroke: "var(--border)" }}
                  />
                  <YAxis
                    type="category"
                    dataKey="category"
                    width={100}
                    tick={{ fill: "var(--foreground)" }}
                    axisLine={{ stroke: "var(--border)" }}
                    tickLine={{ stroke: "var(--border)" }}
                  />
                  <Tooltip
                    formatter={(value) => formatPerfCurrency(Number(value))}
                    contentStyle={{
                      backgroundColor: "var(--card)",
                      border: "1px solid var(--border)",
                      borderRadius: "8px",
                      color: "var(--foreground)",
                    }}
                    labelStyle={{ color: "var(--foreground)" }}
                  />
                  <Legend />
                  <Bar
                    dataKey="priorSpend"
                    fill="var(--muted-foreground)"
                    name="Prior 12 mo"
                    radius={[0, 4, 4, 0]}
                  />
                  <Bar
                    dataKey="spend"
                    fill="var(--chart-2)"
                    name="Last 12 mo"
                    radius={[0, 4, 4, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Prior 12 mo</TableHead>
                  <TableHead className="text-right">Last 12 mo</TableHead>
                  <TableHead className="text-right">vs Prior</TableHead>
                  <TableHead>Trend</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {categories.map((cat) => {
                  const pct = cat.pctOfPrior
                  return (
                    <TableRow key={cat.category}>
                      <TableCell className="font-medium">
                        {cat.category}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatPerfCurrency(cat.priorSpend)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatPerfCurrency(cat.spend)}
                      </TableCell>
                      <TableCell className="text-right">
                        {pct === null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <span
                            className={
                              pct >= 110
                                ? "text-emerald-600 dark:text-emerald-400"
                                : pct >= 90
                                  ? ""
                                  : "text-amber-600 dark:text-amber-400"
                            }
                          >
                            {pct.toFixed(1)}%
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        {pct === null ? (
                          <Badge variant="outline">New category</Badge>
                        ) : pct >= 110 ? (
                          <Badge className="bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100">
                            Growing
                          </Badge>
                        ) : pct >= 90 ? (
                          <Badge variant="secondary">Steady</Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="text-amber-700 dark:text-amber-400"
                          >
                            Declining
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </>
        )}
      </CardContent>
    </Card>
  )
}
