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
}

export function PerformanceCategoriesTab({
  categories,
}: PerformanceCategoriesTabProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Performance by Category</CardTitle>
        <CardDescription>Spend and compliance breakdown by product category</CardDescription>
      </CardHeader>
      <CardContent>
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
              <Bar dataKey="target" fill="var(--muted-foreground)" name="Target" radius={[0, 4, 4, 0]} />
              <Bar dataKey="spend" fill="var(--chart-2)" name="Actual" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Category</TableHead>
              <TableHead className="text-right">Target</TableHead>
              <TableHead className="text-right">Actual</TableHead>
              <TableHead className="text-right">% of Target</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {categories.map((cat) => (
              <TableRow key={cat.category}>
                <TableCell className="font-medium">{cat.category}</TableCell>
                <TableCell className="text-right">{formatPerfCurrency(cat.target)}</TableCell>
                <TableCell className="text-right">{formatPerfCurrency(cat.spend)}</TableCell>
                <TableCell className="text-right">
                  <span
                    className={
                      cat.pct >= 100
                        ? "text-emerald-600 dark:text-emerald-400"
                        : cat.pct >= 90
                          ? ""
                          : "text-amber-600 dark:text-amber-400"
                    }
                  >
                    {cat.pct.toFixed(1)}%
                  </span>
                </TableCell>
                <TableCell>
                  {cat.pct >= 100 ? (
                    <Badge className="bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100">
                      Exceeding
                    </Badge>
                  ) : cat.pct >= 90 ? (
                    <Badge variant="secondary">On Track</Badge>
                  ) : (
                    <Badge variant="outline" className="text-amber-700 dark:text-amber-400">
                      Below Target
                    </Badge>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
