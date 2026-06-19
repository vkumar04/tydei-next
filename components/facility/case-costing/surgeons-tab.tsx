"use client"

/**
 * Case Costing — Surgeons tab.
 *
 * Renders the "Facility payor mix" card above the surgeon-scorecards table.
 * The scorecards table is migrated to the shared <DataTable> with per-column
 * filtering (2026-06-19); column defs live in `surgeon-scorecard-columns.tsx`.
 *
 * Pure presentational — server action calls are in the orchestrator.
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { DataTable } from "@/components/shared/tables/data-table"
import { EmptyState } from "@/components/shared/empty-state"
import { User } from "lucide-react"
import { formatCurrency, formatPercent } from "@/lib/formatting"
import { surgeonScorecardColumns } from "./surgeon-scorecard-columns"
import type { Surgeon } from "@/lib/case-costing/surgeon-derivation"
import type { PayorMixSummary } from "@/lib/case-costing/payor-mix"

interface SurgeonsTabProps {
  scorecards: Surgeon[]
  isLoading: boolean
  payorMix: PayorMixSummary | null
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
          {!isLoading && scorecards.length === 0 ? (
            <EmptyState
              icon={User}
              title="No surgeons yet"
              description="Upload case data to derive surgeon scorecards."
            />
          ) : (
            <DataTable
              columns={surgeonScorecardColumns}
              data={scorecards}
              isLoading={isLoading}
              enableColumnFilters
              searchKey="name"
              searchPlaceholder="Search surgeon…"
              getRowId={(row) => row.name}
              pagination
            />
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
