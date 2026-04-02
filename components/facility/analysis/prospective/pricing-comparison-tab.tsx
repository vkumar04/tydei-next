"use client"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Upload, FileSpreadsheet, Database } from "lucide-react"
import type { ProposalAnalysis } from "@/lib/actions/prospective"

interface COGStatsData {
  totalItems: number
  totalSpend: number
  uniqueVendors: number
  topVendors?: { name: string; count: number }[]
}

export interface PricingComparisonTabProps {
  analysis: ProposalAnalysis | null
  cogStats: COGStatsData | undefined
  formatCurrency: (value: number) => string
  getVarianceColor: (savingsPercent: number) => string
  getVarianceBg: (savingsPercent: number) => string
  onFileUpload: (file: File) => void
}

export function PricingComparisonTab({
  analysis,
  cogStats,
  formatCurrency,
  getVarianceColor,
  getVarianceBg,
  onFileUpload,
}: PricingComparisonTabProps) {
  return (
    <>
      {analysis ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5" />
              Line Item Pricing Comparison
            </CardTitle>
            <CardDescription>
              {analysis.itemComparisons.length} items compared against
              current COG pricing
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="p-4 bg-muted/50 rounded-lg text-center">
                <p className="text-sm text-muted-foreground">
                  Items Analyzed
                </p>
                <p className="text-2xl font-bold">
                  {analysis.itemComparisons.length}
                </p>
              </div>
              <div className="p-4 bg-muted/50 rounded-lg text-center">
                <p className="text-sm text-muted-foreground">
                  Avg Price Variance
                </p>
                <p
                  className={`text-2xl font-bold ${
                    analysis.totalSavingsPercent >= 0
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-red-600 dark:text-red-400"
                  }`}
                >
                  {analysis.totalSavingsPercent >= 0 ? "-" : "+"}
                  {Math.abs(analysis.totalSavingsPercent).toFixed(1)}%
                </p>
              </div>
              <div className="p-4 bg-emerald-50 dark:bg-emerald-950/20 rounded-lg text-center border border-emerald-200 dark:border-emerald-900">
                <p className="text-sm text-emerald-700 dark:text-emerald-300">
                  Items Below COG
                </p>
                <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                  {
                    analysis.itemComparisons.filter((i) => i.savings > 0)
                      .length
                  }
                </p>
              </div>
              <div className="p-4 bg-red-50 dark:bg-red-950/20 rounded-lg text-center border border-red-200 dark:border-red-900">
                <p className="text-sm text-red-700 dark:text-red-300">
                  Items Above COG
                </p>
                <p className="text-2xl font-bold text-red-600 dark:text-red-400">
                  {
                    analysis.itemComparisons.filter((i) => i.savings < 0)
                      .length
                  }
                </p>
              </div>
            </div>

            {/* Potential Savings Banner */}
            {analysis.totalSavings > 0 && (
              <div className="p-4 bg-emerald-50 dark:bg-emerald-950/20 rounded-lg border border-emerald-200 dark:border-emerald-900">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-emerald-800 dark:text-emerald-200">
                      Potential Annual Savings
                    </p>
                    <p className="text-3xl font-bold text-emerald-600 dark:text-emerald-400">
                      {formatCurrency(analysis.totalSavings)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-emerald-700 dark:text-emerald-300">
                      Based on items priced below current COG
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Line Item Table with Variance Heatmap */}
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead>Item #</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">
                      Current Price
                    </TableHead>
                    <TableHead className="text-right">
                      Proposed Price
                    </TableHead>
                    <TableHead className="text-right">
                      Variance %
                    </TableHead>
                    <TableHead className="text-right">Savings</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {analysis.itemComparisons.slice(0, 20).map((item, i) => (
                    <TableRow
                      key={i}
                      className={getVarianceBg(item.savingsPercent)}
                    >
                      <TableCell className="font-mono text-sm">
                        {item.vendorItemNo}
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate">
                        {item.description}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        ${item.currentPrice.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right">
                        ${item.proposedPrice.toFixed(2)}
                      </TableCell>
                      <TableCell
                        className={`text-right font-medium ${getVarianceColor(item.savingsPercent)}`}
                      >
                        {item.savingsPercent >= 0 ? "-" : "+"}
                        {Math.abs(item.savingsPercent).toFixed(1)}%
                      </TableCell>
                      <TableCell
                        className={`text-right font-medium ${item.savings >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}
                      >
                        {item.savings >= 0 ? "" : "-"}$
                        {Math.abs(item.savings).toFixed(2)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {analysis.itemComparisons.length > 20 && (
                <div className="p-3 text-center text-sm text-muted-foreground bg-muted/30">
                  Showing 20 of {analysis.itemComparisons.length} items
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-8">
            <div className="text-center text-muted-foreground">
              <FileSpreadsheet className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p className="font-medium">
                Upload a pricing file to compare
              </p>
              <p className="text-sm mt-1">
                Compare vendor pricing against your current COG data
              </p>
              <Button
                variant="outline"
                className="mt-4"
                onClick={() => {
                  const input = document.createElement("input")
                  input.type = "file"
                  input.accept = ".csv"
                  input.onchange = (e) => {
                    const file = (e.target as HTMLInputElement).files?.[0]
                    if (file) onFileUpload(file)
                  }
                  input.click()
                }}
              >
                <Upload className="h-4 w-4 mr-2" />
                Upload CSV
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* COG Data Status */}
      {cogStats && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Database className="h-5 w-5" />
              COG Data Status
            </CardTitle>
            <CardDescription>
              Your current cost-of-goods data used for pricing comparisons
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="p-4 bg-muted/50 rounded-lg text-center">
                <p className="text-sm text-muted-foreground">
                  Total COG Records
                </p>
                <p className="text-2xl font-bold">
                  {cogStats.totalItems.toLocaleString()}
                </p>
              </div>
              <div className="p-4 bg-muted/50 rounded-lg text-center">
                <p className="text-sm text-muted-foreground">
                  Unique Vendors
                </p>
                <p className="text-2xl font-bold">
                  {cogStats.uniqueVendors}
                </p>
              </div>
              <div className="p-4 bg-muted/50 rounded-lg text-center">
                <p className="text-sm text-muted-foreground">
                  Total COG Spend
                </p>
                <p className="text-2xl font-bold">
                  {formatCurrency(cogStats.totalSpend)}
                </p>
              </div>
            </div>
            {cogStats.topVendors && cogStats.topVendors.length > 0 && (
              <div className="mt-4">
                <p className="text-sm text-muted-foreground mb-2">
                  Top Vendors
                </p>
                <div className="flex flex-wrap gap-2">
                  {cogStats.topVendors.map(
                    (vendor: { name: string; count: number }) => (
                      <Badge
                        key={vendor.name}
                        variant="secondary"
                        className="text-xs"
                      >
                        {vendor.name}{" "}
                        <span className="ml-1 text-muted-foreground">
                          ({vendor.count})
                        </span>
                      </Badge>
                    )
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </>
  )
}
