"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { queryKeys } from "@/lib/query-keys"
import { getTieInCompliance } from "@/lib/actions/analytics/tie-in-compliance"

const fmtUsd = (n: number) =>
  `$${Math.round(n).toLocaleString("en-US")}`

function bonusBadge(level: "none" | "base" | "bonus" | "accelerator") {
  if (level === "none") return <Badge variant="destructive">No rebate</Badge>
  if (level === "accelerator")
    return <Badge variant="default">Accelerator (1.5×)</Badge>
  if (level === "bonus") return <Badge variant="default">Bonus tier</Badge>
  return <Badge variant="secondary">Base rate</Badge>
}

export function TieInComplianceCard({
  contractId,
  initialData,
}: {
  contractId: string
  initialData?: Awaited<ReturnType<typeof getTieInCompliance>>
}) {
  const [mode, setMode] =
    useState<"all_or_nothing" | "proportional">("all_or_nothing")

  const { data, isLoading } = useQuery({
    queryKey: ["analytics", "tieInCompliance", contractId, mode],
    queryFn: () => getTieInCompliance(contractId, mode),
    // initialData only seeds when the dialog opens in the default
    // all_or_nothing mode — switching to proportional triggers a
    // fresh fetch (correct, since the result shape differs).
    initialData: mode === "all_or_nothing" ? initialData : undefined,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
  })

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <CardTitle>Tie-In Bundle Compliance</CardTitle>
          <Select
            value={mode}
            onValueChange={(v) =>
              setMode(v as "all_or_nothing" | "proportional")
            }
          >
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all_or_nothing">All-or-Nothing</SelectItem>
              <SelectItem value="proportional">Proportional</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading || !data ? (
          <Skeleton className="h-48 w-full" />
        ) : (
          <div className="space-y-6">
            {mode === "all_or_nothing" ? (
              <div className="grid gap-4 sm:grid-cols-3">
                <Stat
                  label="Status"
                  value={
                    data.allOrNothing.compliant ? "Compliant" : "Not compliant"
                  }
                  tone={data.allOrNothing.compliant ? "positive" : "negative"}
                  badge={bonusBadge(data.allOrNothing.bonusLevel)}
                />
                <Stat
                  label="Effective rate"
                  value={`${data.allOrNothing.applicableRate.toFixed(2)}%`}
                />
                <Stat
                  label="Rebate earned (YTD)"
                  value={fmtUsd(data.allOrNothing.rebateEarned)}
                />
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-3">
                <Stat
                  label="Overall compliance"
                  value={`${(data.proportional.overallCompliance * 100).toFixed(1)}%`}
                />
                <Stat
                  label="Effective rate"
                  value={`${data.proportional.effectiveRate.toFixed(2)}%`}
                />
                <Stat
                  label="Rebate earned (YTD)"
                  value={fmtUsd(data.proportional.rebateEarned)}
                />
              </div>
            )}

            <div className="space-y-3">
              <h4 className="text-sm font-semibold text-muted-foreground">
                Members
              </h4>
              {data.members.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No bundle members configured.
                </p>
              ) : (
                data.members.map((m) => (
                  <div key={m.name}>
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <span className="font-medium">{m.name}</span>
                      <span className="font-mono text-muted-foreground">
                        {fmtUsd(m.currentSpend)} / {fmtUsd(m.minimumSpend)} (
                        {m.metPct.toFixed(0)}%)
                      </span>
                    </div>
                    <Progress value={m.metPct} />
                  </div>
                ))
              )}
            </div>

            <p className="text-xs text-muted-foreground">
              {mode === "all_or_nothing"
                ? "All members must hit their minimum to earn the bundle rebate. 120%+ unlocks the bonus tier; 150%+ applies the accelerator multiplier."
                : "Each member's compliance ratio is weighted equally; effective rate = base × overall compliance."}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function Stat({
  label,
  value,
  tone,
  badge,
}: {
  label: string
  value: string
  tone?: "positive" | "negative"
  badge?: React.ReactNode
}) {
  const valClass =
    tone === "positive"
      ? "text-emerald-700 dark:text-emerald-400"
      : tone === "negative"
        ? "text-red-700 dark:text-red-400"
        : ""
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-2xl font-semibold ${valClass}`}>{value}</p>
      {badge}
    </div>
  )
}
