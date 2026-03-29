"use client"

import type { ColumnDef } from "@tanstack/react-table"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { TableActionMenu } from "@/components/shared/tables/table-action-menu"
import { Pencil, Trash2 } from "lucide-react"
import { formatDate } from "@/lib/formatting"
import type { AdminUserRow } from "@/lib/actions/admin/users"

const roleBadgeVariant: Record<string, "default" | "secondary" | "outline"> = {
  admin: "default",
  facility: "secondary",
  vendor: "outline",
}

export function getUserColumns(
  onEdit: (user: AdminUserRow) => void,
  onDelete: (user: AdminUserRow) => void
): ColumnDef<AdminUserRow>[] {
  return [
    {
      id: "avatar",
      header: "",
      cell: ({ row }) => (
        <Avatar className="size-8">
          <AvatarImage src={row.original.image ?? undefined} />
          <AvatarFallback>{row.original.name.slice(0, 2).toUpperCase()}</AvatarFallback>
        </Avatar>
      ),
    },
    { accessorKey: "name", header: "Name" },
    { accessorKey: "email", header: "Email" },
    {
      accessorKey: "role",
      header: "Role",
      cell: ({ row }) => (
        <Badge variant={roleBadgeVariant[row.original.role] ?? "outline"} className="capitalize">
          {row.original.role}
        </Badge>
      ),
    },
    { accessorKey: "organizationName", header: "Organization" },
    {
      accessorKey: "createdAt",
      header: "Created",
      cell: ({ row }) => formatDate(row.original.createdAt),
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
