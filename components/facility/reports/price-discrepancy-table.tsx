"use client"

import type { ColumnDef } from "@tanstack/react-table"
import { DataTable } from "@/components/shared/tables/data-table"
import { Badge } from "@/components/ui/badge"
import { formatCurrency, formatPercent } from "@/lib/formatting"

export interface PriceDiscrepancy {
  id: string
  invoiceId: string
  invoiceNumber: string
  vendorName: string
  vendorId: string
  itemDescription: string
  vendorItemNo: string | null
  invoicePrice: number
  contractPrice: number | null
  variancePercent: number | null
  quantity: number
  totalLineCost: number
  isFlagged: boolean
}

const columns: ColumnDef<PriceDiscrepancy>[] = [
  { accessorKey: "invoiceNumber", header: "Invoice #" },
  { accessorKey: "vendorName", header: "Vendor" },
  { accessorKey: "itemDescription", header: "Item" },
  {
    accessorKey: "invoicePrice",
    header: "Invoice Price",
    cell: ({ getValue }) => formatCurrency(getValue<number>(), true),
  },
  {
    accessorKey: "contractPrice",
    header: "Contract Price",
    cell: ({ getValue }) => {
      const v = getValue<number | null>()
      return v != null ? formatCurrency(v, true) : "-"
    },
  },
  {
    accessorKey: "variancePercent",
    header: "Variance",
    cell: ({ getValue }) => {
      const v = getValue<number | null>()
      if (v == null) return "-"
      return (
        <Badge variant={v > 5 ? "destructive" : v > 0 ? "secondary" : "outline"}>
          {formatPercent(v)}
        </Badge>
      )
    },
  },
  { accessorKey: "quantity", header: "Qty" },
  {
    accessorKey: "totalLineCost",
    header: "Total",
    cell: ({ getValue }) => formatCurrency(getValue<number>()),
  },
]

interface PriceDiscrepancyTableProps {
  discrepancies: PriceDiscrepancy[]
}

export function PriceDiscrepancyTable({ discrepancies }: PriceDiscrepancyTableProps) {
  return (
    <DataTable
      columns={columns}
      data={discrepancies}
      searchKey="itemDescription"
      searchPlaceholder="Search items..."
      pagination
      pageSize={20}
    />
  )
}
