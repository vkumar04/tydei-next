"use client"

import type { ColumnDef } from "@tanstack/react-table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Eye } from "lucide-react"
import type { CaseWithRelations } from "@/lib/actions/cases"

export function getCaseColumns(
  onView: (row: CaseWithRelations) => void
): ColumnDef<CaseWithRelations>[] {
  return [
    { accessorKey: "caseNumber", header: "Case #" },
    { accessorKey: "surgeonName", header: "Surgeon" },
    { accessorKey: "dateOfSurgery", header: "Date" },
    { accessorKey: "primaryCptCode", header: "CPT Code" },
    {
      accessorKey: "totalSpend",
      header: "Total Spend",
      cell: ({ row, table }) => {
        const val = row.original.totalSpend
        const allRows = table.getFilteredRowModel().rows
        const avg =
          allRows.length > 0
            ? allRows.reduce(
                (s, r) => s + (r.original as CaseWithRelations).totalSpend,
                0
              ) / allRows.length
            : 0
        const isBelow = avg > 0 && val < avg * 0.9
        const isAbove = avg > 0 && val > avg * 1.1
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
            ${val.toLocaleString()}
          </span>
        )
      },
    },
    {
      accessorKey: "totalReimbursement",
      header: "Reimbursement",
      cell: ({ row }) =>
        `$${row.original.totalReimbursement.toLocaleString()}`,
    },
    {
      accessorKey: "margin",
      header: "Margin",
      cell: ({ row }) => {
        const val = row.original.margin
        return (
          <span className={val >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}>
            ${val.toLocaleString()}
          </span>
        )
      },
    },
    {
      accessorKey: "complianceStatus",
      header: "Compliance",
      cell: ({ row }) => {
        const s = row.original.complianceStatus
        const variant =
          s === "compliant"
            ? "default"
            : s === "non_compliant"
              ? "destructive"
              : "secondary"
        return <Badge variant={variant}>{s.replace("_", " ")}</Badge>
      },
    },
    {
      id: "actions",
      cell: ({ row }) => (
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onView(row.original)}
        >
          <Eye className="size-4" />
        </Button>
      ),
    },
  ]
}
