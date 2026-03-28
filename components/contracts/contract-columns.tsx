"use client"

import type { ColumnDef } from "@tanstack/react-table"
import type { Contract, Vendor, ProductCategory } from "@prisma/client"
import { Eye, Pencil, Trash2 } from "lucide-react"
import { formatCurrency, formatDate } from "@/lib/formatting"
import { contractStatusConfig } from "@/lib/constants"
import { StatusBadge } from "@/components/shared/badges/status-badge"
import { TableActionMenu } from "@/components/shared/tables/table-action-menu"

type ContractWithVendor = Contract & {
  vendor: Pick<Vendor, "id" | "name" | "logoUrl">
  productCategory: Pick<ProductCategory, "id" | "name"> | null
}

interface ColumnActions {
  onView: (id: string) => void
  onEdit: (id: string) => void
  onDelete: (contract: ContractWithVendor) => void
}

export function getContractColumns(
  actions: ColumnActions
): ColumnDef<ContractWithVendor>[] {
  return [
    {
      accessorKey: "name",
      header: "Name",
      cell: ({ row }) => (
        <div>
          <p className="font-medium">{row.original.name}</p>
          {row.original.contractNumber && (
            <p className="text-xs text-muted-foreground">
              {row.original.contractNumber}
            </p>
          )}
        </div>
      ),
    },
    {
      accessorKey: "vendor.name",
      header: "Vendor",
      accessorFn: (row) => row.vendor.name,
    },
    {
      accessorKey: "contractType",
      header: "Type",
      cell: ({ row }) => (
        <span className="capitalize">
          {row.original.contractType.replace("_", " ")}
        </span>
      ),
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => (
        <StatusBadge
          status={row.original.status}
          config={contractStatusConfig}
        />
      ),
    },
    {
      accessorKey: "effectiveDate",
      header: "Effective",
      cell: ({ row }) => formatDate(row.original.effectiveDate),
    },
    {
      accessorKey: "expirationDate",
      header: "Expiration",
      cell: ({ row }) => formatDate(row.original.expirationDate),
    },
    {
      accessorKey: "totalValue",
      header: "Value",
      cell: ({ row }) => formatCurrency(Number(row.original.totalValue)),
    },
    {
      id: "actions",
      cell: ({ row }) => (
        <TableActionMenu
          actions={[
            {
              label: "View",
              icon: Eye,
              onClick: () => actions.onView(row.original.id),
            },
            {
              label: "Edit",
              icon: Pencil,
              onClick: () => actions.onEdit(row.original.id),
            },
            {
              label: "Delete",
              icon: Trash2,
              onClick: () => actions.onDelete(row.original),
              variant: "destructive",
            },
          ]}
        />
      ),
    },
  ]
}
