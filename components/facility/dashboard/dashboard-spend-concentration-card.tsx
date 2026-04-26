"use client"

import { useQuery } from "@tanstack/react-query"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import { queryKeys } from "@/lib/query-keys"
import { getFacilitySpendConcentration } from "@/lib/actions/analytics/spend-concentration"

const TRAILING_DAYS = 365

export function DashboardSpendConcentrationCard({
  facilityId,
}: {
  facilityId: string
}) {
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.analytics.spendConcentration(facilityId, TRAILING_DAYS),
    queryFn: () =>
      getFacilitySpendConcentration({ trailingDays: TRAILING_DAYS }),
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
  })

  const levelBadge = (() => {
    if (!data) return null
    if (data.level === "low") return <Badge variant="default">Low</Badge>
    if (data.level === "moderate")
      return <Badge variant="secondary">Moderate</Badge>
    return <Badge variant="destructive">High</Badge>
  })()

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Vendor Spend Concentration</CardTitle>
          {levelBadge}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading || !data ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <div className="space-y-4">
            <div>
              <div className="text-3xl font-bold">
                {Math.round(data.hhi).toLocaleString("en-US")}
              </div>
              <p className="text-xs text-muted-foreground">
                Herfindahl-Hirschman Index — trailing {TRAILING_DAYS} days
              </p>
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Top vendor share</span>
                <span className="font-mono">
                  {data.topVendorSharePct.toFixed(1)}%
                </span>
              </div>
              <Progress value={data.topVendorSharePct} />
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Top-3 share</span>
                <span className="font-mono">
                  {data.top3SharePct.toFixed(1)}%
                </span>
              </div>
              <Progress value={data.top3SharePct} />
            </div>
            <p className="text-xs text-muted-foreground">
              HHI &lt; 1500 = low, &lt; 2500 = moderate, ≥ 2500 = high.
              Higher concentration = more vendor lock-in risk.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
