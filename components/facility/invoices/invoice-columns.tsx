"use client"

import type { ColumnDef } from "@tanstack/react-table"
import { Eye, CheckCircle } from "lucide-react"
import { formatCurrency, formatDate } from "@/lib/formatting"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

type InvoiceRow = {
  id: string
  invoiceNumber: string
  vendor: { name: string }
  invoiceDate: Date | string
  totalInvoiceCost: number | string | null
  status: string
  flaggedCount: number
  lineItemCount: number
}

export function getInvoiceColumns(
  onView: (id: string) => void,
  onValidate: (id: string) => void
): ColumnDef<InvoiceRow>[] {
  return [
    { accessorKey: "invoiceNumber", header: "Invoice #" },
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
      accessorKey: "totalInvoiceCost",
      header: "Total",
      cell: ({ row }) => formatCurrency(Number(row.original.totalInvoiceCost ?? 0)),
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => {
        const s = row.original.status
        const variant = s === "validated" ? "default" : s === "flagged" ? "destructive" : "secondary"
        return <Badge variant={variant} className="capitalize">{s}</Badge>
      },
    },
    {
      accessorKey: "flaggedCount",
      header: "Discrepancies",
      cell: ({ row }) =>
        row.original.flaggedCount > 0 ? (
          <Badge variant="destructive">{row.original.flaggedCount}</Badge>
        ) : (
          <span className="text-muted-foreground">0</span>
        ),
    },
    {
      id: "actions",
      cell: ({ row }) => (
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" onClick={() => onView(row.original.id)} title="View">
            <Eye className="size-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => onValidate(row.original.id)} title="Validate">
            <CheckCircle className="size-4" />
          </Button>
        </div>
      ),
    },
  ]
}
