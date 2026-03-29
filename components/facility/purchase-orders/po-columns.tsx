"use client"

import type { ColumnDef } from "@tanstack/react-table"
import { Eye } from "lucide-react"
import { formatCurrency, formatDate } from "@/lib/formatting"
import { poStatusConfig } from "@/lib/constants"
import { StatusBadge } from "@/components/shared/badges/status-badge"
import { Button } from "@/components/ui/button"

type PORow = {
  id: string
  poNumber: string
  vendor: { name: string }
  contract: { name: string } | null
  orderDate: Date | string
  totalCost: unknown
  status: string
  _count: { lineItems: number }
}

export function getPOColumns(
  onView: (id: string) => void
): ColumnDef<PORow>[] {
  return [
    { accessorKey: "poNumber", header: "PO #" },
    {
      accessorKey: "vendor.name",
      header: "Vendor",
      accessorFn: (row) => row.vendor.name,
    },
    {
      accessorKey: "orderDate",
      header: "Order Date",
      cell: ({ row }) => formatDate(row.original.orderDate),
    },
    {
      accessorKey: "totalCost",
      header: "Total",
      cell: ({ row }) => formatCurrency(Number(row.original.totalCost ?? 0)),
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => (
        <StatusBadge status={row.original.status} config={poStatusConfig} />
      ),
    },
    {
      accessorKey: "_count.lineItems",
      header: "Items",
      accessorFn: (row) => row._count.lineItems,
    },
    {
      id: "actions",
      cell: ({ row }) => (
        <Button variant="ghost" size="icon" onClick={() => onView(row.original.id)}>
          <Eye className="size-4" />
        </Button>
      ),
    },
  ]
}
