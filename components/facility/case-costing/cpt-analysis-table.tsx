"use client"

import { useMemo } from "react"
import type { ColumnDef } from "@tanstack/react-table"
import { DataTable } from "@/components/shared/tables/data-table"
import type { CPTCodeAnalysis } from "@/lib/actions/cases"

interface CPTAnalysisTableProps {
  analyses: CPTCodeAnalysis[]
}

export function CPTAnalysisTable({ analyses }: CPTAnalysisTableProps) {
  const globalAvg = useMemo(() => {
    if (analyses.length === 0) return 0
    const total = analyses.reduce((s, a) => s + a.avgCost * a.caseCount, 0)
    const count = analyses.reduce((s, a) => s + a.caseCount, 0)
    return count > 0 ? total / count : 0
  }, [analyses])

  const columns: ColumnDef<CPTCodeAnalysis>[] = useMemo(
    () => [
      { accessorKey: "cptCode", header: "CPT Code" },
      {
        accessorKey: "description",
        header: "Description",
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {row.original.description ?? "--"}
          </span>
        ),
      },
      { accessorKey: "caseCount", header: "Cases" },
      {
        accessorKey: "avgCost",
        header: "Avg Cost",
        cell: ({ row }) => {
          const cost = row.original.avgCost
          const isBelow = globalAvg > 0 && cost < globalAvg * 0.9
          const isAbove = globalAvg > 0 && cost > globalAvg * 1.1
          return (
            <span
              className={
                isBelow
                  ? "text-emerald-600 dark:text-emerald-400 font-medium"
                  : isAbove
                    ? "text-red-600 dark:text-red-400 font-medium"
                    : ""
              }
            >
              ${Math.round(cost).toLocaleString()}
            </span>
          )
        },
      },
      {
        accessorKey: "minCost",
        header: "Min",
        cell: ({ row }) =>
          `$${Math.round(row.original.minCost).toLocaleString()}`,
      },
      {
        accessorKey: "maxCost",
        header: "Max",
        cell: ({ row }) =>
          `$${Math.round(row.original.maxCost).toLocaleString()}`,
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
    ],
    [globalAvg]
  )

  return (
    <DataTable
      columns={columns}
      data={analyses}
      searchKey="cptCode"
      searchPlaceholder="Search CPT codes..."
    />
  )
}
