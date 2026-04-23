"use client"

import { useQuery } from "@tanstack/react-query"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { getVendorConcentration } from "@/lib/actions/cog/concentration"

/**
 * Surfaces `calculateSpendConcentration` (Herfindahl-Hirschman Index)
 * on the COG Data page. Shows concentration level badge + top-vendor
 * share + top-3 share. Useful for surfacing at-risk concentration on
 * high-spend facilities where a single vendor dominates.
 */
export function CogVendorConcentrationCard({
  facilityId,
}: {
  facilityId: string
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["cog-vendor-concentration", facilityId],
    queryFn: () => getVendorConcentration(facilityId),
  })

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">
            Vendor concentration
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    )
  }

  if (!data || data.totalSpend === 0) return null

  const levelClass =
    data.level === "high"
      ? "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200"
      : data.level === "moderate"
        ? "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100"
        : "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-100"

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium">
          Vendor concentration
        </CardTitle>
        <CardDescription>
          Herfindahl-Hirschman Index on facility spend. &lt;1500 low ·
          &lt;2500 moderate · else high.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div>
          <p className="text-xs text-muted-foreground">HHI</p>
          <p className="mt-1 text-lg font-semibold tabular-nums">
            {Math.round(data.hhi).toLocaleString()}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Level</p>
          <Badge variant="secondary" className={`mt-1 text-xs ${levelClass}`}>
            {data.level}
          </Badge>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Top vendor</p>
          <p className="mt-1 text-lg font-semibold tabular-nums">
            {data.topVendorSharePct.toFixed(1)}%
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Top 3 combined</p>
          <p className="mt-1 text-lg font-semibold tabular-nums">
            {data.top3SharePct.toFixed(1)}%
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
