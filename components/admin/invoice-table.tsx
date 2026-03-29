"use client"

import { Badge } from "@/components/ui/badge"
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
  { accessorKey: "id", header: "Invoice ID", cell: ({ row }) => row.original.id.slice(0, 20) + "..." },
  { accessorKey: "customerEmail", header: "Customer" },
  {
    accessorKey: "amount",
    header: "Amount",
    cell: ({ row }) => formatCurrency(row.original.amount, true),
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => (
      <Badge variant={statusVariant[row.original.status] ?? "outline"} className="capitalize">
        {row.original.status}
      </Badge>
    ),
  },
  {
    accessorKey: "date",
    header: "Date",
    cell: ({ row }) => formatDate(row.original.date),
  },
]

interface InvoiceTableProps {
  invoices: StripeInvoiceRow[]
}

export function InvoiceTable({ invoices }: InvoiceTableProps) {
  return <DataTable columns={columns} data={invoices} searchKey="customerEmail" searchPlaceholder="Search invoices..." />
}
