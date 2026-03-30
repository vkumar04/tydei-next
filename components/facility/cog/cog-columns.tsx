"use client"

import type { ColumnDef } from "@tanstack/react-table"
import type { COGRecord } from "@prisma/client"
import { Badge } from "@/components/ui/badge"
import { formatCurrency, formatDate } from "@/lib/formatting"
import { TableActionMenu } from "@/components/shared/tables/table-action-menu"
import { Edit, Trash2 } from "lucide-react"

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
      accessorKey: "poNumber",
      header: "PO #",
      cell: ({ row }) => (
        <span className="font-mono text-sm">
          {(row.original as COGRecordWithVendor & { poNumber?: string }).poNumber ?? "\u2014"}
        </span>
      ),
    },
    {
      accessorKey: "transactionDate",
      header: "PO Date",
      cell: ({ row }) => (
        <span className="text-muted-foreground">
          {formatDate(row.original.transactionDate)}
        </span>
      ),
    },
    {
      accessorKey: "inventoryNumber",
      header: "Item #",
      cell: ({ row }) => (
        <span className="font-mono text-sm">
          {row.original.inventoryNumber}
        </span>
      ),
    },
    {
      accessorKey: "inventoryDescription",
      header: "Description",
      cell: ({ row }) => (
        <span
          className="font-medium line-clamp-1"
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
      accessorKey: "quantity",
      header: "Qty",
      cell: ({ row }) => (
        <span className="text-center">
          {(row.original as COGRecordWithVendor & { quantity?: number }).quantity ?? 1}
        </span>
      ),
    },
    {
      accessorKey: "unitCost",
      header: "Unit Price",
      cell: ({ row }) => (
        <span className="text-right font-medium">
          {formatCurrency(Number(row.original.unitCost))}
        </span>
      ),
    },
    {
      accessorKey: "extendedPrice",
      header: "Extended",
      cell: ({ row }) => (
        <span className="text-right font-medium">
          {row.original.extendedPrice
            ? formatCurrency(Number(row.original.extendedPrice))
            : "\u2014"}
        </span>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: ({ row }) => {
        const hasContract = row.original.category && row.original.category !== ""
        return (
          <Badge
            className={
              hasContract
                ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300"
                : "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300"
            }
          >
            {hasContract ? "On Contract" : "Off Contract"}
          </Badge>
        )
      },
    },
    {
      id: "actions",
      cell: ({ row }) => (
        <TableActionMenu
          actions={[
            {
              label: "Edit",
              icon: Edit,
              onClick: () => {},
            },
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
