"use client"

/**
 * Case Costing — Compliance tab.
 *
 * Per docs/superpowers/specs/2026-04-18-case-costing-rewrite.md §4 (subsystem 4).
 * Renders:
 *   - Facility-wide summary card (totals + overall on-contract % + low cases)
 *   - Per-case compliance table (spend on/off + compliance %)
 *
 * Data source: `getFacilityCaseCompliance` → pure helpers in
 * `lib/case-costing/compliance.ts`.
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
import { ShieldCheck, AlertTriangle } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatCurrency, formatPercent } from "@/lib/formatting"
import type { FacilityCaseComplianceResult } from "@/lib/actions/case-costing/compliance"

interface ComplianceTabProps {
  data: FacilityCaseComplianceResult | null
  isLoading: boolean
}

export function ComplianceTab({ data, isLoading }: ComplianceTabProps) {
  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-[260px] w-full" />
      </div>
    )
  }

  if (!data || data.perCase.length === 0) {
    return (
      <EmptyState
        icon={ShieldCheck}
        title="No compliance data yet"
        description="Import case supplies and run enrichment to see on-contract vs. off-contract spend."
      />
    )
  }

  const { summary, perCase } = data

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Facility compliance summary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-4">
            <Stat
              label="Total supply spend"
              value={formatCurrency(summary.totalSupplySpend)}
            />
            <Stat
              label="On contract"
              value={formatCurrency(summary.onContractSpend)}
            />
            <Stat
              label="Off contract"
              value={formatCurrency(summary.offContractSpend)}
              tone={summary.offContractSpend > 0 ? "warn" : undefined}
            />
            <Stat
              label="Overall compliance"
              value={formatPercent(summary.compliancePercent, 1)}
              tone={
                summary.compliancePercent >= 80
                  ? "positive"
                  : summary.compliancePercent >= 50
                    ? "warn"
                    : "negative"
              }
            />
          </div>
          {summary.casesWithLowCompliance > 0 && (
            <div className="mt-4 flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              <AlertTriangle className="h-4 w-4" />
              <span>
                {summary.casesWithLowCompliance} case
                {summary.casesWithLowCompliance === 1 ? "" : "s"} below the 80%
                compliance threshold.
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Per-case compliance</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Case</TableHead>
                <TableHead className="text-right">Total supply spend</TableHead>
                <TableHead className="text-right">On contract</TableHead>
                <TableHead className="text-right">Off contract</TableHead>
                <TableHead className="text-right">Supplies</TableHead>
                <TableHead className="text-right">Compliance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {perCase.map((c) => (
                <TableRow key={c.caseId}>
                  <TableCell className="font-mono text-xs">{c.caseId}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCurrency(c.totalSupplySpend)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCurrency(c.onContractSpend)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCurrency(c.offContractSpend)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {c.suppliesOnContract}/{c.suppliesTotal}
                  </TableCell>
                  <TableCell className="text-right">
                    <Badge
                      variant={
                        c.compliancePercent >= 80
                          ? "default"
                          : c.compliancePercent >= 50
                            ? "secondary"
                            : "destructive"
                      }
                    >
                      {formatPercent(c.compliancePercent, 0)}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}

interface StatProps {
  label: string
  value: string
  tone?: "positive" | "warn" | "negative"
}

function Stat({ label, value, tone }: StatProps) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={cn(
          "text-lg font-bold tabular-nums",
          tone === "positive" && "text-green-600 dark:text-green-400",
          tone === "warn" && "text-amber-600 dark:text-amber-400",
          tone === "negative" && "text-red-600 dark:text-red-400",
        )}
      >
        {value}
      </p>
    </div>
  )
}
