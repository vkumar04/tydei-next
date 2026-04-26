"use client"

import { useQuery } from "@tanstack/react-query"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import { formatCurrency } from "@/lib/formatting"
import { PieChart } from "lucide-react"
import { getFacilityCategorySpend } from "@/lib/actions/cog/facility-category-spend"

const UNCATEGORIZED_FOOTNOTE_THRESHOLD = 0.05

/**
 * Category-spend + market-share-by-category card for the facility
 * dashboard's Spend tab. Charles prod feedback 2026-04-26: "Need
 * something that has market share category and category spend
 * here."
 *
 * For each product category in the trailing 12 months, shows the
 * facility's spend, its share of total facility COG, the number of
 * competing vendors, and the top vendors with their per-category
 * share. Mirrors the per-contract Market Share by Category card's
 * three empty-state branches (no spend / all uncategorized / mixed
 * with footnote) so users get a consistent explanation when data
 * is missing.
 */
export function DashboardCategorySpendCard() {
  const { data, isLoading } = useQuery({
    queryKey: ["facility-category-spend"],
    queryFn: () => getFacilityCategorySpend(),
  })

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PieChart className="h-4 w-4" /> Category spend
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-32 w-full" />
        </CardContent>
      </Card>
    )
  }
  if (!data) return null

  const { rows, uncategorizedSpend, facilityTotalSpend } = data

  // Empty-state 1: no spend at all.
  if (facilityTotalSpend === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PieChart className="h-4 w-4" /> Category spend
          </CardTitle>
          <CardDescription>
            No COG recorded at this facility in the last 12 months.
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  // Empty-state 2: spend exists but all of it is un-categorized.
  if (rows.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PieChart className="h-4 w-4" /> Category spend
          </CardTitle>
          <CardDescription>
            <span className="font-semibold text-foreground">
              {formatCurrency(facilityTotalSpend)}
            </span>{" "}
            of spend in the last 12 months — but none of it is
            categorized. Run COG categorization (or re-import with a
            category column) and this card will populate.
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  const uncategorizedRatio =
    facilityTotalSpend > 0 ? uncategorizedSpend / facilityTotalSpend : 0
  const showUncategorizedFootnote =
    uncategorizedRatio > UNCATEGORIZED_FOOTNOTE_THRESHOLD

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <PieChart className="h-4 w-4" /> Category spend
        </CardTitle>
        <CardDescription>
          Facility spend by product category and the vendors competing
          in each (trailing 12 months, computed from COG).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {rows.map((row) => (
          <div key={row.category} className="space-y-2">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="font-medium">{row.category}</span>
              <span className="tabular-nums">
                <span className="font-semibold">
                  {formatCurrency(row.totalSpend)}
                </span>
                <span className="text-muted-foreground">
                  {" "}
                  · {row.pctOfFacility.toFixed(1)}% of facility ·{" "}
                  {row.vendorCount}{" "}
                  {row.vendorCount === 1 ? "vendor" : "vendors"}
                </span>
              </span>
            </div>
            <Progress value={Math.min(100, row.pctOfFacility)} />
            {row.topVendors.length > 0 && (
              <div className="space-y-1 pl-3 text-xs text-muted-foreground">
                {row.topVendors.map((v) => (
                  <div
                    key={v.vendorId}
                    className="flex items-baseline justify-between gap-3"
                  >
                    <span className="truncate">{v.vendorName}</span>
                    <span className="shrink-0 tabular-nums">
                      <span className="font-medium text-foreground">
                        {v.sharePct.toFixed(1)}%
                      </span>{" "}
                      · {formatCurrency(v.spend)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
        {showUncategorizedFootnote && (
          <p className="border-t pt-3 text-[11px] text-amber-700 dark:text-amber-400">
            Plus {formatCurrency(uncategorizedSpend)} un-categorized (
            {(uncategorizedRatio * 100).toFixed(0)}% of facility total) —
            shares above only reflect categorized spend. Run COG
            categorization to capture the full picture.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
