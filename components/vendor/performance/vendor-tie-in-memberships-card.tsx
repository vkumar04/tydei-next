"use client"

import { useQuery } from "@tanstack/react-query"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import { formatCurrency } from "@/lib/formatting"
import { getVendorCrossVendorTieInMemberships } from "@/lib/actions/analytics/cross-vendor-tie-in"

/**
 * Vendor view of cross-vendor tie-in bundles they're a member of.
 * Each card shows the facility hosting the bundle, this vendor's
 * own commitment + current spend (the row that's bolded), and the
 * other members for context. Bundle bonus % is informational —
 * it's a facility payout, not vendor revenue.
 */
export function VendorTieInMembershipsCard() {
  const { data, isLoading } = useQuery({
    queryKey: ["vendor", "tieInMemberships"],
    queryFn: () => getVendorCrossVendorTieInMemberships(),
  })

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Tie-In Bundle Memberships</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-32 w-full" />
        </CardContent>
      </Card>
    )
  }
  if (!data || data.length === 0) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Tie-In Bundle Memberships ({data.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {data.map((bundle) => (
          <div key={bundle.id} className="rounded-lg border p-4 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h4 className="font-semibold">{bundle.name}</h4>
                <p className="text-xs text-muted-foreground">
                  Hosted by <span className="font-medium">{bundle.facilityName}</span>
                  {" · "}
                  Bonus {bundle.facilityBonusRate}% to facility when{" "}
                  {bundle.facilityBonusRequirement === "all_compliant"
                    ? "all members hit minimum"
                    : "criterion met"}
                </p>
              </div>
              {bundle.result.allCompliant ? (
                <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-0">
                  Bundle compliant
                </Badge>
              ) : (
                <Badge className="bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 border-0">
                  Bundle not yet compliant
                </Badge>
              )}
            </div>

            <div className="space-y-3">
              {bundle.members.map((m) => (
                <div key={m.vendorId}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="font-medium">
                      {m.vendorName}{" "}
                      <span className="text-muted-foreground">
                        @ {m.rebateContribution}%
                      </span>
                    </span>
                    <span className="font-mono text-muted-foreground">
                      {formatCurrency(m.currentSpend)} /{" "}
                      {formatCurrency(m.minimumSpend)} (
                      {m.metPct.toFixed(0)}%)
                    </span>
                  </div>
                  <Progress
                    value={m.metPct}
                    className={
                      m.metPct >= 100
                        ? "[&>div]:bg-emerald-500"
                        : m.metPct >= 75
                          ? "[&>div]:bg-yellow-500"
                          : "[&>div]:bg-red-500"
                    }
                  />
                </div>
              ))}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
