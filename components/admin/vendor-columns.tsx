"use client"

import type { ColumnDef } from "@tanstack/react-table"
import { Badge } from "@/components/ui/badge"
import { TableActionMenu } from "@/components/shared/tables/table-action-menu"
import { Pencil, Trash2 } from "lucide-react"
import type { AdminVendorRow } from "@/lib/actions/admin/vendors"

export function getAdminVendorColumns(
  onEdit: (vendor: AdminVendorRow) => void,
  onDelete: (vendor: AdminVendorRow) => void
): ColumnDef<AdminVendorRow>[] {
  return [
    { accessorKey: "name", header: "Name" },
    { accessorKey: "code", header: "Code" },
    { accessorKey: "contactName", header: "Contact" },
    { accessorKey: "contactEmail", header: "Email" },
    { accessorKey: "contractCount", header: "Contracts" },
    {
      accessorKey: "tier",
      header: "Tier",
      cell: ({ row }) => (
        <Badge variant="outline" className="capitalize">
          {row.original.tier}
        </Badge>
      ),
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => (
        <Badge variant={row.original.status === "active" ? "default" : "secondary"}>
          {row.original.status}
        </Badge>
      ),
    },
    {
      id: "actions",
      cell: ({ row }) => (
        <TableActionMenu
          actions={[
            { label: "Edit", icon: Pencil, onClick: () => onEdit(row.original) },
            { label: "Delete", icon: Trash2, onClick: () => onDelete(row.original), variant: "destructive" },
          ]}
        />
      ),
    },
  ]
}
