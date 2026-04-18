"use client"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { formatCurrency } from "@/lib/formatting"
import type { AdjustedNPV } from "@/lib/financial-analysis/clause-risk-adjustment"

/**
 * Clause-risk adjusted NPV breakdown. Surfaces the base NPV, each rule
 * that fired with its signed percent, and the resulting risk-adjusted
 * NPV. When no clause analysis is available (no indexed PDF yet) the
 * orchestrator should hide this card entirely.
 */
export interface AnalysisClauseRiskCardProps {
  adjusted: AdjustedNPV
}

export function AnalysisClauseRiskCard({
  adjusted,
}: AnalysisClauseRiskCardProps) {
  const { baseNPV, adjustments, totalAdjustmentPercent, riskAdjustedNPV } =
    adjusted
  const signLabel = (pct: number) => (pct >= 0 ? `+${pct}%` : `${pct}%`)
  const toneFor = (pct: number) =>
    pct > 0
      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"
      : "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200"

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Risk-adjusted NPV</CardTitle>
        <CardDescription>
          Starter clause-risk rules applied to the base NPV from the
          contract&apos;s indexed PDF analysis.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Base NPV
            </p>
            <p className="text-xl font-semibold tabular-nums">
              {formatCurrency(baseNPV)}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Total adjustment
            </p>
            <p className="text-xl font-semibold tabular-nums">
              {signLabel(totalAdjustmentPercent)}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Risk-adjusted NPV
            </p>
            <p className="text-xl font-semibold tabular-nums">
              {formatCurrency(riskAdjustedNPV)}
            </p>
          </div>
        </div>

        {adjustments.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No clause-risk rules fired for this contract.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Clause</TableHead>
                  <TableHead className="text-right">Adjustment</TableHead>
                  <TableHead>Reason</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {adjustments.map((adj) => (
                  <TableRow key={adj.clauseCategory}>
                    <TableCell className="font-medium capitalize">
                      {adj.clauseCategory.replace(/_/g, " ")}
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge
                        className={toneFor(adj.adjustmentPercent)}
                        variant="secondary"
                      >
                        {signLabel(adj.adjustmentPercent)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {adj.reason}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
