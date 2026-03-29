"use client"

import type { ColumnDef } from "@tanstack/react-table"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { TableActionMenu } from "@/components/shared/tables/table-action-menu"
import { Pencil, Trash2, CheckCircle, XCircle } from "lucide-react"
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
      accessorKey: "name",
      header: "User",
      cell: ({ row }) => (
        <div className="flex items-center gap-3">
          <Avatar className="h-9 w-9">
            <AvatarImage src={row.original.image ?? undefined} />
            <AvatarFallback className="bg-primary/10 text-primary text-xs">
              {row.original.name
                .split(" ")
                .map((n) => n[0])
                .join("")
                .toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div>
            <p className="font-medium">{row.original.name}</p>
            <p className="text-xs text-muted-foreground">{row.original.email}</p>
          </div>
        </div>
      ),
    },
    {
      accessorKey: "role",
      header: "Role",
      cell: ({ row }) => (
        <Badge variant={roleBadgeVariant[row.original.role] ?? "outline"} className="capitalize">
          {row.original.role}
        </Badge>
      ),
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => {
        const status = (row.original as AdminUserRow & { status?: string }).status ?? "active"
        return (
          <Badge variant={status === "active" ? "default" : "secondary"}>
            {status === "active" ? (
              <><CheckCircle className="mr-1 h-3 w-3" /> Active</>
            ) : (
              <><XCircle className="mr-1 h-3 w-3" /> Inactive</>
            )}
          </Badge>
        )
      },
    },
    { accessorKey: "organizationName", header: "Organization" },
    {
      accessorKey: "createdAt",
      header: "Last Active",
      cell: ({ row }) => (
        <span className="text-muted-foreground">{formatDate(row.original.createdAt)}</span>
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
