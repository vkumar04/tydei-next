"use client"

import type { ColumnDef } from "@tanstack/react-table"
import { Badge } from "@/components/ui/badge"
import { Building2, CheckCircle, XCircle } from "lucide-react"
import { TableActionMenu } from "@/components/shared/tables/table-action-menu"
import { Pencil, Trash2, Users } from "lucide-react"
import type { AdminVendorRow } from "@/lib/actions/admin/vendors"

export function getAdminVendorColumns(
  onEdit: (vendor: AdminVendorRow) => void,
  onDelete: (vendor: AdminVendorRow) => void
): ColumnDef<AdminVendorRow>[] {
  return [
    {
      accessorKey: "name",
      header: "Vendor",
      cell: ({ row }) => (
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted">
            <Building2 className="h-4 w-4" />
          </div>
          <span className="font-medium">{row.original.name}</span>
        </div>
      ),
    },
    {
      accessorKey: "tier",
      header: "Category",
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
          {row.original.status === "active" ? (
            <><CheckCircle className="mr-1 h-3 w-3" /> Active</>
          ) : (
            <><XCircle className="mr-1 h-3 w-3" /> Inactive</>
          )}
        </Badge>
      ),
    },
    {
      accessorKey: "repCount",
      header: () => <div className="text-right">Reps</div>,
      cell: ({ row }) => (
        <div className="text-right">{row.original.repCount}</div>
      ),
    },
    {
      accessorKey: "contractCount",
      header: () => <div className="text-right">Contracts</div>,
      cell: ({ row }) => <div className="text-right">{row.original.contractCount}</div>,
    },
    {
      accessorKey: "createdAt",
      header: () => <div className="text-right">Created</div>,
      cell: ({ row }) => (
        <div className="text-right text-muted-foreground">
          {new Date(row.original.createdAt).toLocaleDateString()}
        </div>
      ),
    },
    {
      id: "actions",
      cell: ({ row }) => (
        <TableActionMenu
          actions={[
            { label: "Edit", icon: Pencil, onClick: () => onEdit(row.original) },
            { label: "Manage Reps", icon: Users, onClick: () => {} },
            { label: "Delete", icon: Trash2, onClick: () => onDelete(row.original), variant: "destructive" },
          ]}
        />
      ),
    },
  ]
}
