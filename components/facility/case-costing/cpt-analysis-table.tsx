"use client"

import type { ColumnDef } from "@tanstack/react-table"
import { DataTable } from "@/components/shared/tables/data-table"
import type { CPTCodeAnalysis } from "@/lib/actions/cases"

const columns: ColumnDef<CPTCodeAnalysis>[] = [
  { accessorKey: "cptCode", header: "CPT Code" },
  { accessorKey: "caseCount", header: "Cases" },
  {
    accessorKey: "avgCost",
    header: "Avg Cost",
    cell: ({ row }) => `$${Math.round(row.original.avgCost).toLocaleString()}`,
  },
  {
    accessorKey: "minCost",
    header: "Min",
    cell: ({ row }) => `$${Math.round(row.original.minCost).toLocaleString()}`,
  },
  {
    accessorKey: "maxCost",
    header: "Max",
    cell: ({ row }) => `$${Math.round(row.original.maxCost).toLocaleString()}`,
  },
  {
    id: "surgeons",
    header: "Surgeons",
    cell: ({ row }) => (
      <span className="text-muted-foreground">
        {row.original.surgeonBreakdown.length} surgeon
        {row.original.surgeonBreakdown.length !== 1 ? "s" : ""}
      </span>
    ),
  },
]

interface CPTAnalysisTableProps {
  analyses: CPTCodeAnalysis[]
}

export function CPTAnalysisTable({ analyses }: CPTAnalysisTableProps) {
  return (
    <DataTable
      columns={columns}
      data={analyses}
      searchKey="cptCode"
      searchPlaceholder="Search CPT codes..."
    />
  )
}
