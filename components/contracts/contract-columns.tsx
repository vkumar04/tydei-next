"use client"

import Link from "next/link"
import type { ColumnDef } from "@tanstack/react-table"
import type { Contract, Vendor, ProductCategory } from "@prisma/client"
import { Eye, Pencil, Trash2 } from "lucide-react"
import { formatCurrency, formatDate } from "@/lib/formatting"
import { contractStatusConfig } from "@/lib/constants"
import { StatusBadge } from "@/components/shared/badges/status-badge"
import { Badge } from "@/components/ui/badge"
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
      header: "Contract Name",
      cell: ({ row }) => (
        <Link
          href={`/dashboard/contracts/${row.original.id}`}
          className="block hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="font-medium">{row.original.name}</p>
          {row.original.contractNumber && (
            <p className="text-xs text-muted-foreground">
              {row.original.contractNumber}
            </p>
          )}
        </Link>
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
        <Badge variant="outline" className="capitalize">
          {row.original.contractType.replace("_", " ")}
        </Badge>
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
      header: "Effective Date",
      cell: ({ row }) => formatDate(row.original.effectiveDate),
    },
    {
      accessorKey: "expirationDate",
      header: "Expiration Date",
      cell: ({ row }) => formatDate(row.original.expirationDate),
    },
    {
      accessorKey: "totalValue",
      header: () => <div className="text-right">Value</div>,
      cell: ({ row }) => (
        <div className="text-right font-medium">
          {formatCurrency(Number(row.original.totalValue))}
        </div>
      ),
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
