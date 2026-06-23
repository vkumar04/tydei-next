"use client"

/**
 * Deal Scenario "Benchmark Position" — shows, per category the vendor sells in,
 * where their ACTUAL ASP and the PROPOSED price (the deal assumption) sit vs
 * the vendor's UPLOADED benchmark (Vick 2026-06-22 "benchmarks wired so they
 * can see where they are vs actuals and assumptions"). Benchmarks come only
 * from uploaded files (getVendorOpportunityData → categoryBenchmarks); a
 * category with no uploaded benchmark shows "—".
 */

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { formatCurrency } from "@/lib/formatting"
import { cn } from "@/lib/utils"
import type { VendorCategoryBenchmark } from "@/lib/actions/vendor-opportunity-data"

export function BenchmarkPositionCard({
  categoryBenchmarks,
  priceChangePct,
}: {
  categoryBenchmarks: VendorCategoryBenchmark[]
  /** Deal Scenario price change vs current ASP, fraction (-0.05 = −5%). */
  priceChangePct: number
}) {
  const anyBenchmark = categoryBenchmarks.some((c) => c.benchmarkAvg != null)
  const pctLabel = `${priceChangePct > 0 ? "+" : ""}${(priceChangePct * 100).toFixed(0)}%`

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Benchmark Position</CardTitle>
        <CardDescription>
          Your actual ASP and the proposed price (current ASP {pctLabel}) vs your
          uploaded benchmark, per category. Benchmarks come only from your
          uploaded files.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {categoryBenchmarks.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">
            No category sales yet — upload COG and a benchmark file to compare.
          </p>
        ) : !anyBenchmark ? (
          <p className="py-4 text-sm text-muted-foreground">
            No benchmarks uploaded yet. Import a benchmark file on the Benchmarks
            tab to see where your pricing sits.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Category</th>
                  <th className="px-3 py-2 text-right font-medium">Benchmark</th>
                  <th className="px-3 py-2 text-right font-medium">Current ASP</th>
                  <th className="px-3 py-2 text-right font-medium">Proposed ASP</th>
                  <th className="px-3 py-2 text-right font-medium">vs Benchmark</th>
                </tr>
              </thead>
              <tbody>
                {categoryBenchmarks.map((c) => {
                  const proposed = c.currentAsp * (1 + priceChangePct)
                  const gap =
                    c.benchmarkAvg && c.benchmarkAvg > 0
                      ? (proposed - c.benchmarkAvg) / c.benchmarkAvg
                      : null
                  return (
                    <tr key={c.category} className="border-t">
                      <td className="px-3 py-2">{c.category}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {c.benchmarkAvg != null
                          ? formatCurrency(c.benchmarkAvg)
                          : "—"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatCurrency(c.currentAsp)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatCurrency(proposed)}
                      </td>
                      <td
                        className={cn(
                          "px-3 py-2 text-right tabular-nums font-medium",
                          gap == null
                            ? "text-muted-foreground"
                            : gap <= 0
                              ? "text-emerald-600 dark:text-emerald-400"
                              : "text-red-600 dark:text-red-400",
                        )}
                      >
                        {gap == null
                          ? "—"
                          : `${gap > 0 ? "+" : ""}${(gap * 100).toFixed(1)}%${gap <= 0 ? " below" : " above"}`}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
