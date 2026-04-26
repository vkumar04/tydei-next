"use client"

import { useQuery } from "@tanstack/react-query"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import { CheckCircle2, XCircle } from "lucide-react"
import { formatCurrency } from "@/lib/formatting"
import { getVendorCrossVendorTieInMemberships } from "@/lib/actions/analytics/cross-vendor-tie-in"

/**
 * Vendor view of cross-vendor tie-in bundles they're a member of.
 * Per the security audit, co-member spends are NOT shown — vendors
 * see their own commitment vs spend, plus a compliant/not-compliant
 * status for each co-member (no $ figures, no minimums). The
 * facility bonus % is shown for context but it's a facility payout.
 */
export function VendorTieInMembershipsCard() {
  const { data, isLoading } = useQuery({
    queryKey: ["vendor", "tieInMemberships"],
    queryFn: () => getVendorCrossVendorTieInMemberships(),
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
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
                  Hosted by{" "}
                  <span className="font-medium">{bundle.facilityName}</span>
                  {" · "}
                  Bonus {bundle.facilityBonusRate}% to facility when{" "}
                  {bundle.facilityBonusRequirement === "all_compliant"
                    ? "all members hit minimum"
                    : "criterion met"}
                </p>
              </div>
              {bundle.bundleCompliant ? (
                <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-0">
                  Bundle compliant ({bundle.membersCompliant}/{bundle.membersTotal})
                </Badge>
              ) : (
                <Badge className="bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 border-0">
                  {bundle.membersCompliant}/{bundle.membersTotal} compliant
                </Badge>
              )}
            </div>

            {/* Self row — full visibility on this vendor's commitment + spend. */}
            <div className="rounded-md border bg-muted/30 p-3">
              <div className="mb-2 flex items-center justify-between text-xs">
                <span className="font-semibold">
                  {bundle.self.vendorName}{" "}
                  <span className="text-muted-foreground font-normal">
                    @ {bundle.self.rebateContribution}% (you)
                  </span>
                </span>
                <span className="font-mono text-muted-foreground">
                  {formatCurrency(bundle.self.currentSpend)} /{" "}
                  {formatCurrency(bundle.self.minimumSpend)} (
                  {bundle.self.metPct.toFixed(0)}%)
                </span>
              </div>
              <Progress
                value={bundle.self.metPct}
                className={
                  bundle.self.metPct >= 100
                    ? "[&>div]:bg-emerald-500"
                    : bundle.self.metPct >= 75
                      ? "[&>div]:bg-yellow-500"
                      : "[&>div]:bg-red-500"
                }
              />
            </div>

            {/* Co-members — name + rate + compliance status only.
                Spend $ + minimums are intentionally redacted because
                this vendor shouldn't see competitor revenue at the
                same facility (security audit High finding). */}
            {bundle.coMembers.length > 0 ? (
              <div>
                <p className="mb-2 text-xs font-semibold text-muted-foreground">
                  Co-members
                </p>
                <div className="space-y-1.5">
                  {bundle.coMembers.map((m) => (
                    <div
                      key={m.vendorId}
                      className="flex items-center justify-between rounded-md border px-3 py-2 text-xs"
                    >
                      <span>
                        {m.vendorName}{" "}
                        <span className="text-muted-foreground">
                          @ {m.rebateContribution}%
                        </span>
                      </span>
                      {m.compliant ? (
                        <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Compliant
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-yellow-600 dark:text-yellow-400">
                          <XCircle className="h-3.5 w-3.5" />
                          Not yet
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
