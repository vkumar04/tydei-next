"use client"

/**
 * Case Costing — Cases tab.
 *
 * Per docs/superpowers/specs/2026-04-18-case-costing-rewrite.md §4.1.
 * Renders a table of cases scoped to the active facility with:
 *   case # / date / surgeon / CPT / cost / margin / payor mix hint.
 * Filter bar is `cases-list-filters.tsx`.
 */

import { useMemo } from "react"
import {
  Card,
  CardContent,
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
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/shared/empty-state"
import { Stethoscope } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatCurrency, formatDate, formatPercent } from "@/lib/formatting"
import { calculateMargin } from "@/lib/case-costing/score-calc"
import { CasesListFilters } from "./cases-list-filters"
import type { GetCasesForFacilityFilters } from "@/lib/actions/case-costing/cases-list"
import type { CaseRow } from "./case-costing-types"

interface CasesListTabProps {
  data: CaseRow[]
  isLoading: boolean
  filters: GetCasesForFacilityFilters
  onFiltersChange: (next: GetCasesForFacilityFilters) => void
  surgeonOptions: string[]
  cptOptions: string[]
}

export function CasesListTab({
  data,
  isLoading,
  filters,
  onFiltersChange,
  surgeonOptions,
  cptOptions,
}: CasesListTabProps) {
  const rows = useMemo(() => {
    return data.map((c) => {
      const totalSpend = Number(c.totalSpend)
      const totalReimbursement = Number(c.totalReimbursement)
      const margin = calculateMargin({ totalSpend, totalReimbursement })
      const supplyCount = c.supplies?.length ?? 0
      const onContractCount = (c.supplies ?? []).filter((s) =>
        Boolean(s.contractId),
      ).length
      const compliancePct =
        supplyCount > 0 ? (onContractCount / supplyCount) * 100 : 0
      return {
        id: c.id,
        caseNumber: c.caseNumber,
        surgeon: c.surgeonName ?? "—",
        date: c.dateOfSurgery,
        cpt: c.primaryCptCode ?? "—",
        totalSpend,
        totalReimbursement,
        marginPct: margin.marginPct,
        grossMargin: margin.grossMargin,
        trend: margin.trend,
        compliancePct,
        supplyCount,
        onContractCount,
      }
    })
  }, [data])

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cases</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <CasesListFilters
            filters={filters}
            onChange={onFiltersChange}
            surgeonOptions={surgeonOptions}
            cptOptions={cptOptions}
          />

          {isLoading ? (
            <LoadingRows />
          ) : rows.length === 0 ? (
            <EmptyState
              icon={Stethoscope}
              title="No cases match"
              description="Adjust your filters or import case data to see rows here."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Case #</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Surgeon</TableHead>
                  <TableHead>CPT</TableHead>
                  <TableHead className="text-right">Spend</TableHead>
                  <TableHead className="text-right">Reimb.</TableHead>
                  <TableHead className="text-right">Margin</TableHead>
                  <TableHead>Compliance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.caseNumber}</TableCell>
                    <TableCell>{formatDate(r.date)}</TableCell>
                    <TableCell>{r.surgeon}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{r.cpt}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(r.totalSpend)}
                    </TableCell>
                    <TableCell className="text-right">
                      {r.totalReimbursement > 0
                        ? formatCurrency(r.totalReimbursement)
                        : "—"}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-right font-medium tabular-nums",
                        r.totalReimbursement === 0
                          ? "text-muted-foreground"
                          : r.grossMargin >= 0
                            ? "text-green-600 dark:text-green-400"
                            : "text-red-600 dark:text-red-400",
                      )}
                    >
                      {r.totalReimbursement > 0
                        ? `${formatPercent(r.marginPct)} · ${formatCurrency(r.grossMargin)}`
                        : "—"}
                    </TableCell>
                    <TableCell>
                      {r.supplyCount > 0 ? (
                        <div className="flex items-center gap-2">
                          <Badge
                            variant={
                              r.compliancePct >= 80
                                ? "default"
                                : r.compliancePct >= 50
                                  ? "secondary"
                                  : "destructive"
                            }
                          >
                            {formatPercent(r.compliancePct, 0)}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {r.onContractCount}/{r.supplyCount} on contract
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          No supplies
                        </span>
                      )}
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

function LoadingRows() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-9 w-full" />
      ))}
    </div>
  )
}
