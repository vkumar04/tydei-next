"use client"

import type { ColumnDef } from "@tanstack/react-table"
import type { COGRecord } from "@prisma/client"
import { Badge } from "@/components/ui/badge"
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
      header: "Item #",
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
        <span
          className="max-w-[200px] truncate block font-medium"
          title={row.original.inventoryDescription}
        >
          {row.original.inventoryDescription}
        </span>
      ),
    },
    {
      accessorKey: "vendor.name",
      header: "Vendor",
      cell: ({ row }) =>
        row.original.vendor?.name ?? row.original.vendorName ?? "\u2014",
    },
    {
      accessorKey: "unitCost",
      header: "Unit Cost",
      cell: ({ row }) => (
        <span className="text-right font-medium">
          {formatCurrency(Number(row.original.unitCost), true)}
        </span>
      ),
    },
    {
      accessorKey: "extendedPrice",
      header: "Extended Price",
      cell: ({ row }) => (
        <span className="text-right font-medium">
          {row.original.extendedPrice
            ? formatCurrency(Number(row.original.extendedPrice), true)
            : "\u2014"}
        </span>
      ),
    },
    {
      accessorKey: "transactionDate",
      header: "Transaction Date",
      cell: ({ row }) => (
        <span className="text-muted-foreground">
          {formatDate(row.original.transactionDate)}
        </span>
      ),
    },
    {
      accessorKey: "category",
      header: "Category",
      cell: ({ row }) =>
        row.original.category ? (
          <Badge variant="outline">{row.original.category}</Badge>
        ) : (
          <span className="text-muted-foreground">\u2014</span>
        ),
    },
    {
      id: "status",
      header: "Status",
      cell: () => (
        <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300">
          Active
        </Badge>
      ),
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
