"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Skeleton } from "@/components/ui/skeleton"
import { DepreciationChart } from "../depreciation-chart"
import { PriceProjectionChart } from "../price-projection-chart"
import type { DepreciationSchedule } from "@/lib/analysis/depreciation"
import type { PriceProjection } from "@/lib/actions/analysis"
import { DollarSign, Percent, TrendingUp } from "lucide-react"

interface YearlyProjection {
  year: number
  spend: number
  revenue: number
  rebate: number
  netCashFlow: number
}

export interface ProjectionsTabProps {
  schedule: DepreciationSchedule | null
  totalCapitalValue: number
  avgDepreciationRate: number
  projectedAnnualSpend: number
  vtLoading: boolean
  projLoading: boolean
  projections: PriceProjection[] | undefined
  yearlyProjections: YearlyProjection[]
  totalRebate: number
  contractLength: number
  annualGrowthRate: number
  formatCurrency: (value: number) => string
}

export function ProjectionsTab({
  schedule,
  totalCapitalValue,
  avgDepreciationRate,
  projectedAnnualSpend,
  vtLoading,
  projLoading,
  projections,
  yearlyProjections,
  totalRebate,
  contractLength,
  annualGrowthRate,
  formatCurrency,
}: ProjectionsTabProps) {
  return (
    <div className="space-y-6">
      {/* Stat Cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="border-l-4 border-l-blue-500">
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">
                  Total Capital Value
                </p>
                <p className="text-2xl font-bold">
                  {schedule
                    ? formatCurrency(totalCapitalValue)
                    : "--"}
                </p>
                {schedule && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {schedule.recoveryPeriod}-year MACRS
                  </p>
                )}
              </div>
              <DollarSign className="h-8 w-8 text-muted-foreground/30" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-amber-500">
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">
                  Average Depreciation Rate
                </p>
                <p className="text-2xl font-bold">
                  {schedule ? `${avgDepreciationRate}%` : "--"}
                </p>
                {schedule && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Per year (
                    {schedule.convention.replace("_", " ")})
                  </p>
                )}
              </div>
              <Percent className="h-8 w-8 text-muted-foreground/30" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-emerald-500">
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">
                  Projected Annual Spend
                </p>
                <p className="text-2xl font-bold">
                  {vtLoading
                    ? "--"
                    : formatCurrency(projectedAnnualSpend)}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Annualized from trend data
                </p>
              </div>
              <TrendingUp className="h-8 w-8 text-muted-foreground/30" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Yearly Projections Table */}
      <Card>
        <CardHeader>
          <CardTitle>Yearly Cash Flow Projections</CardTitle>
          <CardDescription>
            Projected spend, revenue, rebate, and net cash flow over the
            {contractLength}-year contract at {annualGrowthRate}% annual
            growth
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Year</TableHead>
                <TableHead className="text-right">
                  Projected Spend
                </TableHead>
                <TableHead className="text-right">
                  Projected Revenue
                </TableHead>
                <TableHead className="text-right">
                  Projected Rebate
                </TableHead>
                <TableHead className="text-right">
                  Net Cash Flow
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {yearlyProjections.map((row) => (
                <TableRow key={row.year}>
                  <TableCell className="font-medium">
                    Year {row.year}
                  </TableCell>
                  <TableCell className="text-right">
                    ${Math.round(row.spend).toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right">
                    ${Math.round(row.revenue).toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right">
                    ${Math.round(row.rebate).toLocaleString()}
                  </TableCell>
                  <TableCell
                    className={`text-right font-medium ${
                      row.netCashFlow >= 0
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-red-600 dark:text-red-400"
                    }`}
                  >
                    ${Math.round(row.netCashFlow).toLocaleString()}
                  </TableCell>
                </TableRow>
              ))}
              {/* Totals row */}
              <TableRow className="font-bold border-t-2">
                <TableCell>Total</TableCell>
                <TableCell className="text-right">
                  $
                  {Math.round(
                    yearlyProjections.reduce((s, y) => s + y.spend, 0)
                  ).toLocaleString()}
                </TableCell>
                <TableCell className="text-right">
                  $
                  {Math.round(
                    yearlyProjections.reduce(
                      (s, y) => s + y.revenue,
                      0
                    )
                  ).toLocaleString()}
                </TableCell>
                <TableCell className="text-right">
                  ${Math.round(totalRebate).toLocaleString()}
                </TableCell>
                <TableCell
                  className={`text-right ${
                    yearlyProjections.reduce(
                      (s, y) => s + y.netCashFlow,
                      0
                    ) >= 0
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-red-600 dark:text-red-400"
                  }`}
                >
                  $
                  {Math.round(
                    yearlyProjections.reduce(
                      (s, y) => s + y.netCashFlow,
                      0
                    )
                  ).toLocaleString()}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {schedule && <DepreciationChart schedule={schedule} />}

      {projLoading ? (
        <Skeleton className="h-[340px] rounded-xl" />
      ) : (
        <PriceProjectionChart projections={projections ?? []} />
      )}
    </div>
  )
}
