"use client"

import type { ColumnDef } from "@tanstack/react-table"
import { DataTable } from "@/components/shared/tables/data-table"
import { useInvoices } from "@/hooks/use-invoices"
import { formatCurrency, formatDate } from "@/lib/formatting"
import { Badge } from "@/components/ui/badge"

type InvoiceRow = {
  id: string
  invoiceNumber: string
  facility: { name: string } | null
  invoiceDate: Date | string
  totalInvoiceCost: number | string | null
  status: string
  lineItemCount: number
}

const columns: ColumnDef<InvoiceRow>[] = [
  { accessorKey: "invoiceNumber", header: "Invoice #" },
  {
    accessorKey: "facility.name",
    header: "Facility",
    accessorFn: (row) => row.facility?.name ?? "N/A",
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
    cell: ({ row }) => (
      <Badge variant={row.original.status === "validated" ? "default" : "secondary"} className="capitalize">
        {row.original.status}
      </Badge>
    ),
  },
  {
    accessorKey: "lineItemCount",
    header: "Items",
  },
]

interface VendorInvoiceListProps {
  vendorId: string
}

export function VendorInvoiceList({ vendorId }: VendorInvoiceListProps) {
  const { data, isLoading } = useInvoices(vendorId, { vendorId })

  return (
    <DataTable
      columns={columns}
      data={(data?.invoices as unknown as InvoiceRow[]) ?? []}
      searchKey="invoiceNumber"
      searchPlaceholder="Search invoices..."
      isLoading={isLoading}
    />
  )
}
