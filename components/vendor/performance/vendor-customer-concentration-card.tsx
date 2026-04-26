"use client"

import { useQuery } from "@tanstack/react-query"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import { getVendorCustomerConcentration } from "@/lib/actions/analytics/vendor-customer-concentration"

const TRAILING_DAYS = 365

export function VendorCustomerConcentrationCard() {
  const { data, isLoading } = useQuery({
    queryKey: ["vendor", "customerConcentration", TRAILING_DAYS],
    queryFn: () =>
      getVendorCustomerConcentration({ trailingDays: TRAILING_DAYS }),
  })

  const levelBadge = (() => {
    if (!data) return null
    if (data.level === "low")
      return (
        <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-0">
          Low
        </Badge>
      )
    if (data.level === "moderate")
      return (
        <Badge className="bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 border-0">
          Moderate
        </Badge>
      )
    return (
      <Badge className="bg-red-500/15 text-red-600 dark:text-red-400 border-0">
        High
      </Badge>
    )
  })()

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">
            Customer Concentration (HHI)
          </CardTitle>
          {levelBadge}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading || !data ? (
          <Skeleton className="h-40 w-full" />
        ) : data.facilityCount === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No COG attributed to this vendor in the last {TRAILING_DAYS} days.
          </p>
        ) : (
          <div className="space-y-4">
            <div>
              <div className="text-3xl font-bold">
                {Math.round(data.hhi).toLocaleString("en-US")}
              </div>
              <p className="text-xs text-muted-foreground">
                Across {data.facilityCount} facility
                {data.facilityCount === 1 ? "" : "s"} — trailing{" "}
                {data.trailingDays} days
              </p>
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Top facility share</span>
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
              HHI &lt; 1500 = healthy diversification, ≥ 2500 = high churn
              exposure (a single facility loss would dent revenue).
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
