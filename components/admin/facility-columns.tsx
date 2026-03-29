"use client"

import type { ColumnDef } from "@tanstack/react-table"
import { Badge } from "@/components/ui/badge"
import { TableActionMenu } from "@/components/shared/tables/table-action-menu"
import { Pencil, Trash2 } from "lucide-react"
import type { AdminFacilityRow } from "@/lib/actions/admin/facilities"

export function getFacilityColumns(
  onEdit: (facility: AdminFacilityRow) => void,
  onDelete: (facility: AdminFacilityRow) => void
): ColumnDef<AdminFacilityRow>[] {
  return [
    { accessorKey: "name", header: "Name" },
    {
      accessorKey: "type",
      header: "Type",
      cell: ({ row }) => (
        <span className="capitalize">{row.original.type.replace("_", " ")}</span>
      ),
    },
    { accessorKey: "healthSystemName", header: "Health System" },
    {
      id: "location",
      header: "Location",
      cell: ({ row }) => {
        const { city, state } = row.original
        return city && state ? `${city}, ${state}` : city ?? state ?? "—"
      },
    },
    { accessorKey: "userCount", header: "Users" },
    { accessorKey: "contractCount", header: "Contracts" },
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
