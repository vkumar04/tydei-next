"use client"

import type { ColumnDef } from "@tanstack/react-table"
import type { COGRecord, Vendor } from "@prisma/client"
import { formatCurrency, formatDate } from "@/lib/formatting"
import { TableActionMenu } from "@/components/shared/tables/table-action-menu"
import { Trash2 } from "lucide-react"

type COGRecordWithVendor = COGRecord & {
  vendor: { id: string; name: string } | null
}

interface COGColumnOptions {
  onDelete: (record: COGRecordWithVendor) => void
}

export function getCOGColumns({
  onDelete,
}: COGColumnOptions): ColumnDef<COGRecordWithVendor>[] {
  return [
    {
      accessorKey: "inventoryNumber",
      header: "Inv #",
      cell: ({ row }) => (
        <span className="font-mono text-xs">
          {row.original.inventoryNumber}
        </span>
      ),
    },
    {
      accessorKey: "inventoryDescription",
      header: "Description",
      cell: ({ row }) => (
        <span className="max-w-[200px] truncate block">
          {row.original.inventoryDescription}
        </span>
      ),
    },
    {
      accessorKey: "vendor.name",
      header: "Vendor",
      cell: ({ row }) =>
        row.original.vendor?.name ?? row.original.vendorName ?? "—",
    },
    {
      accessorKey: "vendorItemNo",
      header: "Item No",
      cell: ({ row }) => row.original.vendorItemNo ?? "—",
    },
    {
      accessorKey: "unitCost",
      header: "Unit Cost",
      cell: ({ row }) => formatCurrency(Number(row.original.unitCost), true),
    },
    {
      accessorKey: "quantity",
      header: "Qty",
    },
    {
      accessorKey: "extendedPrice",
      header: "Extended",
      cell: ({ row }) =>
        row.original.extendedPrice
          ? formatCurrency(Number(row.original.extendedPrice), true)
          : "—",
    },
    {
      accessorKey: "transactionDate",
      header: "Date",
      cell: ({ row }) => formatDate(row.original.transactionDate),
    },
    {
      id: "actions",
      cell: ({ row }) => (
        <TableActionMenu
          actions={[
            {
              label: "Delete",
              icon: Trash2,
              onClick: () => onDelete(row.original),
              variant: "destructive",
            },
          ]}
        />
      ),
    },
  ]
}
