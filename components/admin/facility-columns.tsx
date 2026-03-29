"use client"

import type { ColumnDef } from "@tanstack/react-table"
import { Badge } from "@/components/ui/badge"
import { Building2, CheckCircle, XCircle } from "lucide-react"
import { TableActionMenu } from "@/components/shared/tables/table-action-menu"
import { Pencil, Trash2, Users } from "lucide-react"
import type { AdminFacilityRow } from "@/lib/actions/admin/facilities"

export function getFacilityColumns(
  onEdit: (facility: AdminFacilityRow) => void,
  onDelete: (facility: AdminFacilityRow) => void
): ColumnDef<AdminFacilityRow>[] {
  return [
    {
      accessorKey: "name",
      header: "Facility",
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
      id: "location",
      header: "Location",
      cell: ({ row }) => {
        const { city, state } = row.original
        return (
          <span className="text-muted-foreground">
            {city && state ? `${city}, ${state}` : city ?? state ?? "\u2014"}
          </span>
        )
      },
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
      accessorKey: "userCount",
      header: () => <div className="text-right">Users</div>,
      cell: ({ row }) => <div className="text-right">{row.original.userCount}</div>,
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
            { label: "Manage Users", icon: Users, onClick: () => {} },
            { label: "Delete", icon: Trash2, onClick: () => onDelete(row.original), variant: "destructive" },
          ]}
        />
      ),
    },
  ]
}
