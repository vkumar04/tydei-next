"use client"

/**
 * Case Costing — Surgeons tab.
 *
 * Per docs/superpowers/specs/2026-04-18-case-costing-rewrite.md §4.2.
 * Renders surgeon scorecards table with:
 *   - name / specialty
 *   - overall score (colored by score-calc thresholds)
 *   - payor mix (commercial+private / total)
 *   - total + avg spend + margin %
 *
 * Pure presentational — server action calls are in the orchestrator.
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/shared/empty-state"
import { User } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatCurrency, formatPercent } from "@/lib/formatting"
import type { Surgeon } from "@/lib/case-costing/surgeon-derivation"
import type { ScoreColor } from "@/lib/case-costing/score-calc"
import type { PayorMixSummary } from "@/lib/case-costing/payor-mix"

interface SurgeonsTabProps {
  scorecards: Surgeon[]
  isLoading: boolean
  payorMix: PayorMixSummary | null
}

const COLOR_CLASSES: Record<ScoreColor, string> = {
  green: "bg-green-100 text-green-800 dark:bg-green-950/50 dark:text-green-300",
  amber: "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300",
  red: "bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300",
}

export function SurgeonsTab({
  scorecards,
  isLoading,
  payorMix,
}: SurgeonsTabProps) {
  return (
    <div className="space-y-4">
      {payorMix && <FacilityPayorMixCard summary={payorMix} />}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Surgeon scorecards</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : scorecards.length === 0 ? (
            <EmptyState
              icon={User}
              title="No surgeons yet"
              description="Upload case data to derive surgeon scorecards."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Surgeon</TableHead>
                  <TableHead>Specialty</TableHead>
                  <TableHead className="text-right">Cases</TableHead>
                  <TableHead className="text-right">Total spend</TableHead>
                  <TableHead className="text-right">Avg spend</TableHead>
                  <TableHead className="text-right">Margin %</TableHead>
                  <TableHead>Payor mix</TableHead>
                  <TableHead className="text-center">Score</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {scorecards.map((s) => (
                  <TableRow key={s.name}>
                    <TableCell className="font-medium">{s.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{s.specialty}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {s.caseCount.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(s.totalSpend)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(s.avgSpendPerCase)}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-right tabular-nums",
                        s.avgMarginPct >= 30
                          ? "text-green-600 dark:text-green-400"
                          : s.avgMarginPct > 0
                            ? "text-amber-600 dark:text-amber-400"
                            : "text-muted-foreground",
                      )}
                    >
                      {s.totalReimbursement > 0
                        ? formatPercent(s.avgMarginPct)
                        : "—"}
                    </TableCell>
                    <TableCell>
                      {s.totalPayors > 0 ? (
                        <span className="text-xs text-muted-foreground">
                          {s.commercialOrPrivatePayors}/{s.totalPayors} commercial
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          No payor data
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      <span
                        className={cn(
                          "inline-flex min-w-[42px] items-center justify-center rounded-full px-2 py-0.5 text-xs font-semibold",
                          COLOR_CLASSES[s.color],
                        )}
                        aria-label={`Overall score ${s.overallScore}, color ${s.color}`}
                      >
                        {s.overallScore}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function FacilityPayorMixCard({ summary }: { summary: PayorMixSummary }) {
  const rows: Array<{ key: string; label: string }> = [
    { key: "commercial", label: "Commercial" },
    { key: "medicare", label: "Medicare" },
    { key: "medicaid", label: "Medicaid" },
    { key: "private", label: "Private" },
    { key: "workers_comp", label: "Workers' comp" },
    { key: "other", label: "Other" },
  ]

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Facility payor mix</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {rows.map((r) => {
            const share =
              summary.shares[r.key as keyof typeof summary.shares] ?? 0
            const reimb =
              summary.reimbursementByPayor[
                r.key as keyof typeof summary.reimbursementByPayor
              ] ?? 0
            return (
              <div key={r.key} className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">{r.label}</p>
                <p className="text-lg font-bold tabular-nums">
                  {formatPercent(share * 100, 0)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatCurrency(reimb)}
                </p>
              </div>
            )
          })}
        </div>
        {summary.casesWithoutPayor > 0 && (
          <p className="mt-3 text-xs text-muted-foreground">
            {summary.casesWithoutPayor} case
            {summary.casesWithoutPayor === 1 ? "" : "s"} missing payor data
            (excluded from share denominator).
          </p>
        )}
      </CardContent>
    </Card>
  )
}
