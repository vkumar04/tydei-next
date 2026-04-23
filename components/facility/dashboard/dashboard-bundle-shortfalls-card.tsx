"use client"

import Link from "next/link"
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
import { AlertTriangle } from "lucide-react"
import { getFacilityBundleShortfalls } from "@/lib/actions/bundles-shortfalls"
import { formatCurrency } from "@/lib/formatting"

/**
 * Dashboard card listing every tie-in bundle with at least one member
 * below minimum spend. Renders nothing when all bundles are healthy —
 * it's a focus-your-attention signal, not a permanent tile.
 */
export function DashboardBundleShortfallsCard() {
  const { data, isLoading } = useQuery({
    queryKey: ["bundle-shortfalls"],
    queryFn: () => getFacilityBundleShortfalls(),
  })

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Bundle shortfalls</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-16 w-full" />
        </CardContent>
      </Card>
    )
  }
  if (!data || data.length === 0) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          Bundle shortfalls ({data.length})
        </CardTitle>
        <CardDescription>
          Tie-in bundles with at least one member below minimum spend.
          All-or-nothing bundles forfeit their full rebate until all minimums
          are met.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {data.map((row) => (
          <Link
            key={row.bundleId}
            href={`/dashboard/contracts/bundles/${row.bundleId}`}
            className="flex items-center justify-between rounded-md border p-3 transition hover:bg-muted"
          >
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{row.bundleLabel}</span>
                <Badge variant="outline" className="text-xs">
                  {row.complianceMode}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                {row.vendorName} · {row.shortfallCount} of {row.memberCount}{" "}
                member{row.memberCount === 1 ? "" : "s"} below min
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground">Largest gap</p>
              <p className="text-sm font-semibold tabular-nums text-amber-700">
                {formatCurrency(row.largestShortfall)}
              </p>
            </div>
          </Link>
        ))}
      </CardContent>
    </Card>
  )
}
