"use client"

import type { ColumnDef } from "@tanstack/react-table"
import { Badge } from "@/components/ui/badge"
import { Building2, CheckCircle, XCircle } from "lucide-react"
import { TableActionMenu } from "@/components/shared/tables/table-action-menu"
import { Pencil, Trash2, Users } from "lucide-react"
import type { AdminVendorRow } from "@/lib/actions/admin/vendors"
import { formatDate } from "@/lib/formatting"

export function getAdminVendorColumns(
  onEdit: (vendor: AdminVendorRow) => void,
  onDelete: (vendor: AdminVendorRow) => void
): ColumnDef<AdminVendorRow>[] {
  return [
    {
      accessorKey: "name",
      header: "Vendor",
      meta: { filterVariant: "text", filterLabel: "Vendor" },
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
      meta: { filterVariant: "select", filterLabel: "Category" },
      cell: ({ row }) => (
        <Badge variant="outline" className="capitalize">
          {row.original.tier}
        </Badge>
      ),
    },
    {
      accessorKey: "status",
      header: "Status",
      meta: { filterVariant: "select" },
      /**
       * Charles 2026-07-28: "it says these are all active but only the ASFD is."
       *
       * He is right, and the badge was not lying so much as reporting a column
       * that means nothing here. `Vendor.status` is `@default("active")` and
       * bulk ingestion never sets it, so every vendor auto-minted from a COG /
       * PO / invoice file is born "Active" — 201 of 201 in production.
       *
       * The column that actually separates a real tenant from an import
       * artifact is `organizationId`: without an Organization there are no
       * Members, so nobody can sign in. Lead with that (`canHaveUsers`), and
       * keep the status badge only when it carries real information — an
       * explicitly deactivated vendor.
       */
      cell: ({ row }) => {
        const { status, canHaveUsers } = row.original
        if (status !== "active") {
          return (
            <Badge variant="secondary">
              <XCircle className="mr-1 h-3 w-3" /> Inactive
            </Badge>
          )
        }
        return canHaveUsers ? (
          <Badge variant="default">
            <CheckCircle className="mr-1 h-3 w-3" /> Onboarded
          </Badge>
        ) : (
          <Badge variant="outline" title="Created from an imported file — no organization, so it has no users and nobody can sign in.">
            Catalog only
          </Badge>
        )
      },
    },
    {
      accessorKey: "repCount",
      header: () => <div className="text-right">Reps</div>,
      meta: { filterVariant: "range", filterLabel: "Reps" },
      cell: ({ row }) => (
        <div className="text-right">{row.original.repCount}</div>
      ),
    },
    {
      accessorKey: "contractCount",
      header: () => <div className="text-right">Contracts</div>,
      meta: { filterVariant: "range", filterLabel: "Contracts" },
      cell: ({ row }) => <div className="text-right">{row.original.contractCount}</div>,
    },
    {
      accessorKey: "createdAt",
      header: () => <div className="text-right">Created</div>,
      meta: { filterVariant: "none" },
      cell: ({ row }) => (
        <div className="text-right text-muted-foreground">
          {formatDate(row.original.createdAt)}
        </div>
      ),
    },
    {
      id: "actions",
      meta: { filterVariant: "none" },
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
