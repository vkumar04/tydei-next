"use client"

/**
 * Case Costing — Cases tab.
 *
 * Renders a table of cases scoped to the active facility with:
 *   case # / date / surgeon / CPT / cost / margin / compliance.
 * Migrated to the shared <DataTable> with per-column filtering (2026-06-19);
 * the only surviving control in `cases-list-filters.tsx` is the date-range
 * time-scope selector (which drives the SERVER query). Surgeon / CPT
 * filtering is now done per-column on the table.
 */

import { useMemo } from "react"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { DataTable } from "@/components/shared/tables/data-table"
import { EmptyState } from "@/components/shared/empty-state"
import { Stethoscope } from "lucide-react"
import { calculateMargin } from "@/lib/case-costing/score-calc"
import { CasesListFilters } from "./cases-list-filters"
import { caseListColumns, type CaseListRow } from "./case-list-columns"
import type { GetCasesForFacilityFilters } from "@/lib/actions/case-costing/cases-list"
import type { CaseRow } from "./case-costing-types"

interface CasesListTabProps {
  data: CaseRow[]
  isLoading: boolean
  filters: GetCasesForFacilityFilters
  onFiltersChange: (next: GetCasesForFacilityFilters) => void
}

export function CasesListTab({
  data,
  isLoading,
  filters,
  onFiltersChange,
}: CasesListTabProps) {
  const rows = useMemo<CaseListRow[]>(() => {
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
          <CasesListFilters filters={filters} onChange={onFiltersChange} />

          {!isLoading && rows.length === 0 ? (
            <EmptyState
              icon={Stethoscope}
              title="No cases match"
              description="Adjust your filters or import case data to see rows here."
            />
          ) : (
            <DataTable
              columns={caseListColumns}
              data={rows}
              isLoading={isLoading}
              enableColumnFilters
              searchKey="caseNumber"
              searchPlaceholder="Search case #…"
              getRowId={(row) => row.id}
              pagination
            />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
