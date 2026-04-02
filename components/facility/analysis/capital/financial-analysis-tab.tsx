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
import { SpendTrendChart } from "../spend-trend-chart"

interface DepreciationRow {
  year: number
  rate: number
  depreciation: number
  taxSavings: number
  accumulated: number
}

interface PriceLockRow {
  year: number
  yourPrice: number
  marketPrice: number
  extraCost: number
  totalExtraCost: number
}

interface VendorTrendItem {
  month: string
  vendorName?: string
  spend: number
}

interface CategoryTrendItem {
  month: string
  categoryName?: string
  spend: number
}

export interface FinancialAnalysisTabProps {
  npv: number
  irr: number
  trueCost: number
  totalRebate: number
  totalTaxSavings: number
  contractTotal: number
  discountRate: number
  rebatePercent: number
  contractLength: number
  taxRate: number
  depreciationSchedule: DepreciationRow[]
  priceLockCosts: PriceLockRow[]
  vendorTrends: VendorTrendItem[] | undefined
  catTrends: CategoryTrendItem[] | undefined
  vtLoading: boolean
  ctLoading: boolean
  formatCurrency: (value: number) => string
}

export function FinancialAnalysisTab({
  npv,
  irr,
  trueCost,
  totalRebate,
  totalTaxSavings,
  contractTotal,
  discountRate,
  rebatePercent,
  contractLength,
  taxRate,
  depreciationSchedule,
  priceLockCosts,
  vendorTrends,
  catTrends,
  vtLoading,
  ctLoading,
  formatCurrency,
}: FinancialAnalysisTabProps) {
  return (
    <div className="space-y-6">
      {/* Summary Metric Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="border-l-4 border-l-blue-500">
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">
              Net Present Value (NPV)
            </p>
            <p
              className={`text-2xl font-bold ${
                npv >= 0
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-red-600 dark:text-red-400"
              }`}
            >
              ${Math.round(npv).toLocaleString()}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              At {discountRate}% discount rate
            </p>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-amber-500">
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">
              Internal Rate of Return (IRR)
            </p>
            <p className="text-2xl font-bold">{irr.toFixed(1)}%</p>
            <p className="text-xs text-muted-foreground mt-1">
              {irr > discountRate
                ? "Exceeds discount rate"
                : "Below discount rate"}
            </p>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-purple-500">
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">
              True Cost of Capital
            </p>
            <p className="text-2xl font-bold">
              ${Math.round(trueCost).toLocaleString()}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              After rebates &amp; tax savings
            </p>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-emerald-500">
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">
              Total Projected Rebate
            </p>
            <p className="text-2xl font-bold">
              ${Math.round(totalRebate).toLocaleString()}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {rebatePercent}% over {contractLength} years
            </p>
          </CardContent>
        </Card>
      </div>

      {/* MACRS Depreciation Table */}
      <Card>
        <CardHeader>
          <CardTitle>MACRS Depreciation Schedule</CardTitle>
          <CardDescription>
            5-year Modified Accelerated Cost Recovery System at{" "}
            {taxRate}% tax rate
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Year</TableHead>
                <TableHead className="text-right">
                  MACRS Rate
                </TableHead>
                <TableHead className="text-right">
                  Depreciation Amount
                </TableHead>
                <TableHead className="text-right">
                  Tax Savings
                </TableHead>
                <TableHead className="text-right">
                  Accumulated Depreciation
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {depreciationSchedule.map((row) => (
                <TableRow key={row.year}>
                  <TableCell className="font-medium">
                    Year {row.year}
                  </TableCell>
                  <TableCell className="text-right">
                    {row.rate.toFixed(1)}%
                  </TableCell>
                  <TableCell className="text-right">
                    ${Math.round(row.depreciation).toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right text-emerald-600 dark:text-emerald-400">
                    ${Math.round(row.taxSavings).toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right">
                    ${Math.round(row.accumulated).toLocaleString()}
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="font-bold border-t-2">
                <TableCell>Total</TableCell>
                <TableCell className="text-right">100.0%</TableCell>
                <TableCell className="text-right">
                  ${Math.round(contractTotal).toLocaleString()}
                </TableCell>
                <TableCell className="text-right text-emerald-600 dark:text-emerald-400">
                  ${Math.round(totalTaxSavings).toLocaleString()}
                </TableCell>
                <TableCell className="text-right">
                  ${Math.round(contractTotal).toLocaleString()}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Price Lock Cost Table */}
      <Card>
        <CardHeader>
          <CardTitle>Price Lock Cost Analysis</CardTitle>
          <CardDescription>
            Opportunity cost of locked-in pricing vs declining market
            prices (2% annual decrease)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Year</TableHead>
                <TableHead className="text-right">
                  Your Price (Locked)
                </TableHead>
                <TableHead className="text-right">
                  Market Price
                </TableHead>
                <TableHead className="text-right">
                  Extra Cost
                </TableHead>
                <TableHead className="text-right">
                  Cumulative Extra Cost
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {priceLockCosts.map((row) => (
                <TableRow key={row.year}>
                  <TableCell className="font-medium">
                    Year {row.year}
                  </TableCell>
                  <TableCell className="text-right">
                    ${Math.round(row.yourPrice).toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right">
                    ${Math.round(row.marketPrice).toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right text-red-600 dark:text-red-400">
                    ${Math.round(row.extraCost).toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right text-red-600 dark:text-red-400">
                    $
                    {Math.round(row.totalExtraCost).toLocaleString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Existing Spend Trend Charts */}
      {vtLoading ? (
        <Skeleton className="h-[380px] rounded-xl" />
      ) : (
        <SpendTrendChart
          data={vendorTrends ?? []}
          groupBy="vendor"
        />
      )}

      {ctLoading ? (
        <Skeleton className="h-[380px] rounded-xl" />
      ) : (
        <>
          <SpendTrendChart
            data={catTrends ?? []}
            groupBy="category"
          />

          {catTrends && catTrends.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">
                  Category Breakdown
                </CardTitle>
                <CardDescription>
                  Spend distribution across product categories
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {(() => {
                    const catTotals = new Map<string, number>()
                    for (const item of catTrends) {
                      const name = item.categoryName ?? "Other"
                      catTotals.set(
                        name,
                        (catTotals.get(name) ?? 0) + item.spend
                      )
                    }
                    const sorted = Array.from(catTotals.entries())
                      .sort((a, b) => b[1] - a[1])
                      .slice(0, 6)
                    const grandTotal = sorted.reduce(
                      (s, [, v]) => s + v,
                      0
                    )
                    return sorted.map(([name, spend]) => {
                      const pct =
                        grandTotal > 0
                          ? Math.round((spend / grandTotal) * 100)
                          : 0
                      return (
                        <div key={name} className="space-y-1">
                          <div className="flex justify-between text-sm">
                            <span className="font-medium">
                              {name}
                            </span>
                            <span className="text-muted-foreground">
                              {formatCurrency(spend)} ({pct}%)
                            </span>
                          </div>
                          <div className="h-2 bg-muted rounded-full overflow-hidden">
                            <div
                              className="h-full bg-primary transition-all"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      )
                    })
                  })()}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
