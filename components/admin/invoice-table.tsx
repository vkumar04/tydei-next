"use client"

import { Badge } from "@/components/ui/badge"
import { Building2, CheckCircle, AlertCircle } from "lucide-react"
import { DataTable } from "@/components/shared/tables/data-table"
import { formatCurrency, formatDate } from "@/lib/formatting"
import type { ColumnDef } from "@tanstack/react-table"
import type { StripeInvoiceRow } from "@/lib/actions/admin/billing"

const statusVariant: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  paid: "default",
  open: "secondary",
  void: "outline",
  uncollectible: "destructive",
}

const columns: ColumnDef<StripeInvoiceRow>[] = [
  {
    accessorKey: "id",
    header: "Invoice",
    cell: ({ row }) => (
      <span className="font-mono text-sm">{row.original.id.slice(0, 20)}...</span>
    ),
  },
  {
    accessorKey: "customerEmail",
    header: "Organization",
    cell: ({ row }) => (
      <div className="flex items-center gap-2">
        <Building2 className="h-4 w-4 text-muted-foreground" />
        {row.original.customerEmail ?? "Unknown"}
      </div>
    ),
  },
  {
    accessorKey: "amount",
    header: () => <div className="text-right">Amount</div>,
    cell: ({ row }) => (
      <div className="text-right font-medium">{formatCurrency(row.original.amount, true)}</div>
    ),
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => {
      const status = row.original.status
      return (
        <Badge variant={statusVariant[status] ?? "outline"}>
          {status === "paid" && <CheckCircle className="mr-1 h-3 w-3" />}
          {(status === "uncollectible" || status === "void") && <AlertCircle className="mr-1 h-3 w-3" />}
          {status.charAt(0).toUpperCase() + status.slice(1)}
        </Badge>
      )
    },
  },
  {
    accessorKey: "date",
    header: () => <div className="text-right">Date</div>,
    cell: ({ row }) => (
      <div className="text-right text-muted-foreground">{formatDate(row.original.date)}</div>
    ),
  },
]

interface InvoiceTableProps {
  invoices: StripeInvoiceRow[]
}

export function InvoiceTable({ invoices }: InvoiceTableProps) {
  return <DataTable columns={columns} data={invoices} searchKey="customerEmail" searchPlaceholder="Search invoices..." />
}
