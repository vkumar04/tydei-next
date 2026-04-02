"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import type { PriceProjection, VendorSpendTrend } from "@/lib/actions/analysis"
import { CheckCircle2, AlertTriangle } from "lucide-react"

interface YearlyProjection {
  year: number
  spend: number
  revenue: number
  rebate: number
  netCashFlow: number
}

export interface SummaryReportTabProps {
  contractTotal: number
  contractLength: number
  npv: number
  irr: number
  discountRate: number
  totalRebate: number
  totalTaxSavings: number
  totalPriceLockCost: number
  trueCost: number
  yearlyProjections: YearlyProjection[]
  projections: PriceProjection[] | undefined
  vendorTrends: VendorSpendTrend[] | undefined
  formatCurrency: (value: number) => string
}

export function SummaryReportTab({
  contractTotal,
  contractLength,
  npv,
  irr,
  discountRate,
  totalRebate,
  totalTaxSavings,
  totalPriceLockCost,
  trueCost,
  yearlyProjections,
  projections,
  vendorTrends,
  formatCurrency,
}: SummaryReportTabProps) {
  return (
    <div className="space-y-6">
      {/* Contract Summary */}
      <Card>
        <CardHeader>
          <CardTitle>Contract Summary</CardTitle>
          <CardDescription>
            Overview of the capital contract terms
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-lg bg-muted/50 p-4 text-center">
              <p className="text-sm text-muted-foreground">
                Contract Total
              </p>
              <p className="text-xl font-bold">
                ${Math.round(contractTotal).toLocaleString()}
              </p>
            </div>
            <div className="rounded-lg bg-muted/50 p-4 text-center">
              <p className="text-sm text-muted-foreground">
                Contract Length
              </p>
              <p className="text-xl font-bold">
                {contractLength} Years
              </p>
            </div>
            <div className="rounded-lg bg-muted/50 p-4 text-center">
              <p className="text-sm text-muted-foreground">
                Annual Payment
              </p>
              <p className="text-xl font-bold">
                $
                {Math.round(
                  contractTotal / contractLength
                ).toLocaleString()}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Key Financial Metrics */}
      <Card>
        <CardHeader>
          <CardTitle>Key Financial Metrics</CardTitle>
          <CardDescription>
            Comprehensive financial analysis results
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-1 rounded-lg border p-4">
              <p className="text-sm text-muted-foreground">
                Net Present Value
              </p>
              <p
                className={`text-lg font-bold ${
                  npv >= 0
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-red-600 dark:text-red-400"
                }`}
              >
                ${Math.round(npv).toLocaleString()}
              </p>
            </div>
            <div className="space-y-1 rounded-lg border p-4">
              <p className="text-sm text-muted-foreground">
                Internal Rate of Return
              </p>
              <p className="text-lg font-bold">{irr.toFixed(1)}%</p>
            </div>
            <div className="space-y-1 rounded-lg border p-4">
              <p className="text-sm text-muted-foreground">
                Discount Rate
              </p>
              <p className="text-lg font-bold">
                {discountRate.toFixed(1)}%
              </p>
            </div>
            <div className="space-y-1 rounded-lg border p-4">
              <p className="text-sm text-muted-foreground">
                Total Projected Spend
              </p>
              <p className="text-lg font-bold">
                $
                {Math.round(
                  yearlyProjections.reduce((s, y) => s + y.spend, 0)
                ).toLocaleString()}
              </p>
            </div>
            <div className="space-y-1 rounded-lg border p-4">
              <p className="text-sm text-muted-foreground">
                Total Rebate
              </p>
              <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400">
                ${Math.round(totalRebate).toLocaleString()}
              </p>
            </div>
            <div className="space-y-1 rounded-lg border p-4">
              <p className="text-sm text-muted-foreground">
                Total Tax Savings
              </p>
              <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400">
                ${Math.round(totalTaxSavings).toLocaleString()}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* True Cost Formula */}
      <Card>
        <CardHeader>
          <CardTitle>True Cost of Capital</CardTitle>
          <CardDescription>
            Net cost accounting for all financial factors
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg bg-muted/50 p-6">
            <div className="flex flex-wrap items-center justify-center gap-2 text-sm sm:text-base">
              <div className="text-center">
                <p className="text-xs text-muted-foreground">
                  Contract Total
                </p>
                <p className="font-bold">
                  ${Math.round(contractTotal).toLocaleString()}
                </p>
              </div>
              <span className="text-xl font-bold text-muted-foreground">
                +
              </span>
              <div className="text-center">
                <p className="text-xs text-muted-foreground">
                  Price Lock Cost
                </p>
                <p className="font-bold text-red-600 dark:text-red-400">
                  $
                  {Math.round(totalPriceLockCost).toLocaleString()}
                </p>
              </div>
              <span className="text-xl font-bold text-muted-foreground">
                -
              </span>
              <div className="text-center">
                <p className="text-xs text-muted-foreground">
                  Rebates
                </p>
                <p className="font-bold text-emerald-600 dark:text-emerald-400">
                  ${Math.round(totalRebate).toLocaleString()}
                </p>
              </div>
              <span className="text-xl font-bold text-muted-foreground">
                -
              </span>
              <div className="text-center">
                <p className="text-xs text-muted-foreground">
                  Tax Savings
                </p>
                <p className="font-bold text-emerald-600 dark:text-emerald-400">
                  ${Math.round(totalTaxSavings).toLocaleString()}
                </p>
              </div>
              <span className="text-xl font-bold text-muted-foreground">
                =
              </span>
              <div className="text-center">
                <p className="text-xs text-muted-foreground">
                  True Cost
                </p>
                <p className="text-lg font-bold">
                  ${Math.round(trueCost).toLocaleString()}
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Recommendation */}
      <Card
        className={`border-l-4 ${
          npv >= 0 && irr > discountRate
            ? "border-l-emerald-500"
            : "border-l-amber-500"
        }`}
      >
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {npv >= 0 && irr > discountRate ? (
              <>
                <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                Recommendation: Favorable
              </>
            ) : (
              <>
                <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                Recommendation: Requires Further Consideration
              </>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {npv >= 0 && irr > discountRate ? (
            <p className="text-muted-foreground">
              This contract shows a positive NPV of{" "}
              <span className="font-medium text-foreground">
                ${Math.round(npv).toLocaleString()}
              </span>{" "}
              and an IRR of{" "}
              <span className="font-medium text-foreground">
                {irr.toFixed(1)}%
              </span>{" "}
              which exceeds the discount rate of{" "}
              <span className="font-medium text-foreground">
                {discountRate.toFixed(1)}%
              </span>
              . The contract is projected to generate value above the
              required rate of return, making it a financially favorable
              investment. Total rebates of{" "}
              <span className="font-medium text-foreground">
                ${Math.round(totalRebate).toLocaleString()}
              </span>{" "}
              and tax savings of{" "}
              <span className="font-medium text-foreground">
                ${Math.round(totalTaxSavings).toLocaleString()}
              </span>{" "}
              further reduce the effective cost.
            </p>
          ) : (
            <p className="text-muted-foreground">
              This contract shows an NPV of{" "}
              <span className="font-medium text-foreground">
                ${Math.round(npv).toLocaleString()}
              </span>{" "}
              and an IRR of{" "}
              <span className="font-medium text-foreground">
                {irr.toFixed(1)}%
              </span>
              .{" "}
              {npv < 0
                ? "The negative NPV suggests the contract may not generate sufficient returns to justify the investment at the current discount rate. "
                : ""}
              {irr <= discountRate
                ? `The IRR does not exceed the discount rate of ${discountRate.toFixed(1)}%, indicating the return may be below the required threshold. `
                : ""}
              Consider negotiating better terms, increasing the rebate
              percentage, or reducing the contract total to improve the
              financial profile.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Existing projection details preserved below */}
      {projections && projections.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              Projection Details
            </CardTitle>
            <CardDescription>
              Monthly projected price changes over the next{" "}
              {projections.length} periods
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-lg bg-muted/50 p-4 text-center">
                <p className="text-sm text-muted-foreground">
                  Current Avg Price
                </p>
                <p className="text-xl font-bold">
                  $
                  {projections[0]?.currentPrice.toFixed(2) ?? "0.00"}
                </p>
              </div>
              <div className="rounded-lg bg-muted/50 p-4 text-center">
                <p className="text-sm text-muted-foreground">
                  Projected End Price
                </p>
                <p className="text-xl font-bold">
                  $
                  {projections[
                    projections.length - 1
                  ]?.projectedPrice.toFixed(2) ?? "0.00"}
                </p>
              </div>
              <div className="rounded-lg bg-muted/50 p-4 text-center">
                <p className="text-sm text-muted-foreground">
                  Total Change
                </p>
                <p
                  className={`text-xl font-bold ${
                    (projections[projections.length - 1]
                      ?.changePercent ?? 0) < 0
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-red-600 dark:text-red-400"
                  }`}
                >
                  {(
                    projections[projections.length - 1]
                      ?.changePercent ?? 0
                  ).toFixed(1)}
                  %
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Vendor Summary Cards */}
      {vendorTrends && vendorTrends.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(() => {
            const vendorTotals = new Map<string, number>()
            for (const item of vendorTrends) {
              const name = item.vendorName ?? "Unknown"
              vendorTotals.set(
                name,
                (vendorTotals.get(name) ?? 0) + item.spend
              )
            }
            return Array.from(vendorTotals.entries())
              .sort((a, b) => b[1] - a[1])
              .slice(0, 6)
              .map(([name, spend]) => (
                <Card key={name}>
                  <CardContent className="pt-4">
                    <p className="text-sm font-medium truncate">
                      {name}
                    </p>
                    <p className="text-xl font-bold mt-1">
                      {formatCurrency(spend)}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {
                        vendorTrends.filter(
                          (t) => t.vendorName === name
                        ).length
                      }{" "}
                      months of data
                    </p>
                  </CardContent>
                </Card>
              ))
          })()}
        </div>
      )}
    </div>
  )
}
