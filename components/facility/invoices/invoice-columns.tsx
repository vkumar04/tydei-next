"use client"

import type { ColumnDef } from "@tanstack/react-table"
import { Eye, FileText } from "lucide-react"
import { formatCurrency, formatDate, formatPercent } from "@/lib/formatting"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

export type InvoiceRow = {
  id: string
  invoiceNumber: string
  vendor: { name: string }
  invoiceDate: Date | string
  totalInvoiceCost: number | string | null
  totalContractCost: number
  variance: number
  variancePercent: number
  status: string
  flaggedCount: number
  lineItemCount: number
}

const statusConfig: Record<string, { label: string; className: string }> = {
  pending: {
    label: "Pending",
    className:
      "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300 hover:bg-yellow-100",
  },
  flagged: {
    label: "Flagged",
    className:
      "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300 hover:bg-red-100",
  },
  validated: {
    label: "Validated",
    className:
      "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300 hover:bg-green-100",
  },
  disputed: {
    label: "Disputed",
    className:
      "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300 hover:bg-orange-100",
  },
}

export function getInvoiceColumns(
  onView: (id: string) => void
): ColumnDef<InvoiceRow>[] {
  return [
    {
      accessorKey: "invoiceNumber",
      header: "Invoice #",
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <FileText className="size-4 text-muted-foreground" />
          <span className="font-medium">{row.original.invoiceNumber}</span>
        </div>
      ),
    },
    {
      accessorKey: "vendor.name",
      header: "Vendor",
      accessorFn: (row) => row.vendor.name,
    },
    {
      accessorKey: "invoiceDate",
      header: "Date",
      cell: ({ row }) => formatDate(row.original.invoiceDate),
    },
    {
      accessorKey: "lineItemCount",
      header: "Line Items",
      cell: ({ row }) => (
        <span className="text-muted-foreground">{row.original.lineItemCount}</span>
      ),
    },
    {
      accessorKey: "totalInvoiceCost",
      header: "Invoice Amount",
      cell: ({ row }) => formatCurrency(Number(row.original.totalInvoiceCost ?? 0)),
    },
    {
      accessorKey: "totalContractCost",
      header: "Contract Amount",
      cell: ({ row }) => formatCurrency(row.original.totalContractCost),
    },
    {
      accessorKey: "variance",
      header: "Variance",
      cell: ({ row }) => {
        const v = row.original.variance
        const vp = row.original.variancePercent
        if (Math.abs(v) < 0.01) {
          return <span className="text-green-600 dark:text-green-400">Match</span>
        }
        return (
          <div className="flex items-center gap-2">
            <span className={v > 0 ? "font-medium text-red-600 dark:text-red-400" : "font-medium text-green-600 dark:text-green-400"}>
              {v > 0 ? "+" : ""}
              {formatCurrency(v)}
            </span>
            <Badge variant="outline" className="text-xs">
              {vp > 0 ? "+" : ""}
              {formatPercent(vp)}
            </Badge>
          </div>
        )
      },
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => {
        const s = row.original.status
        const cfg = statusConfig[s] ?? {
          label: s,
          className: "bg-muted text-muted-foreground",
        }
        return (
          <Badge variant="secondary" className={cfg.className}>
            {cfg.label}
          </Badge>
        )
      },
    },
    {
      id: "actions",
      header: "Actions",
      cell: ({ row }) => (
        <Button
          variant="ghost"
          size="icon"
          onClick={(e) => {
            e.stopPropagation()
            onView(row.original.id)
          }}
          title="View Details"
        >
          <Eye className="size-4" />
        </Button>
      ),
    },
  ]
}
