"use client"

import { useQuery } from "@tanstack/react-query"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import { formatCurrency } from "@/lib/formatting"
import { getCrossVendorTieIns } from "@/lib/actions/analytics/cross-vendor-tie-in"

export function CrossVendorTieInsCard() {
  const { data, isLoading } = useQuery({
    queryKey: ["analytics", "crossVendorTieIns"],
    queryFn: () => getCrossVendorTieIns(),
  })

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cross-Vendor Tie-Ins</CardTitle>
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
          Cross-Vendor Tie-Ins ({data.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {data.map((tieIn) => (
          <div
            key={tieIn.id}
            className="rounded-lg border p-4 space-y-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h4 className="font-semibold">{tieIn.name}</h4>
                <p className="text-xs text-muted-foreground">
                  Bonus {tieIn.facilityBonusRate}% on total spend when{" "}
                  {tieIn.facilityBonusRequirement === "all_compliant"
                    ? "all members hit minimum"
                    : "criterion met"}
                </p>
              </div>
              {tieIn.result.allCompliant ? (
                <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-0">
                  All compliant — bonus unlocked
                </Badge>
              ) : (
                <Badge className="bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 border-0">
                  Bonus locked
                </Badge>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <Stat
                label="Vendor rebates"
                value={formatCurrency(tieIn.result.vendorRebateTotal)}
              />
              <Stat
                label="Facility bonus"
                value={formatCurrency(tieIn.result.facilityBonus)}
                tone={tieIn.result.facilityBonus > 0 ? "positive" : "muted"}
              />
              <Stat
                label="Total rebate"
                value={formatCurrency(tieIn.result.totalRebate)}
                tone="positive"
              />
            </div>

            <div className="space-y-3">
              {tieIn.members.map((m) => (
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

function Stat({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone?: "positive" | "muted"
}) {
  const valClass =
    tone === "positive"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "muted"
        ? "text-muted-foreground"
        : ""
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-lg font-semibold ${valClass}`}>{value}</p>
    </div>
  )
}
