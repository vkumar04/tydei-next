"use client"

import type { ColumnDef } from "@tanstack/react-table"
import type { Vendor } from "@prisma/client"
import { TableActionMenu } from "@/components/shared/tables/table-action-menu"
import { StatusBadge } from "@/components/shared/badges/status-badge"
import { Pencil, Ban } from "lucide-react"
import type { StatusConfig } from "@/lib/types"

const vendorStatusConfig: Record<string, StatusConfig> = {
  active: { label: "Active", variant: "default", className: "bg-emerald-600 hover:bg-emerald-600" },
  inactive: { label: "Inactive", variant: "secondary" },
}

interface VendorColumnOptions {
  onEdit: (vendor: Vendor) => void
  onDeactivate: (vendor: Vendor) => void
}

export function getVendorColumns({
  onEdit,
  onDeactivate,
}: VendorColumnOptions): ColumnDef<Vendor>[] {
  return [
    {
      accessorKey: "name",
      header: "Name",
      cell: ({ row }) => (
        <span className="font-medium">{row.original.name}</span>
      ),
    },
    {
      accessorKey: "code",
      header: "Code",
      cell: ({ row }) => row.original.code ?? "—",
    },
    {
      accessorKey: "contactEmail",
      header: "Email",
      cell: ({ row }) => row.original.contactEmail ?? "—",
    },
    {
      accessorKey: "contactPhone",
      header: "Phone",
      cell: ({ row }) => row.original.contactPhone ?? "—",
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => (
        <StatusBadge status={row.original.status} config={vendorStatusConfig} />
      ),
    },
    {
      accessorKey: "tier",
      header: "Tier",
      cell: ({ row }) => (
        <span className="capitalize">{row.original.tier}</span>
      ),
    },
    {
      id: "actions",
      cell: ({ row }) => (
        <TableActionMenu
          actions={[
            {
              label: "Edit",
              icon: Pencil,
              onClick: () => onEdit(row.original),
            },
            ...(row.original.status === "active"
              ? [
                  {
                    label: "Deactivate",
                    icon: Ban,
                    onClick: () => onDeactivate(row.original),
                    variant: "destructive" as const,
                  },
                ]
              : []),
          ]}
        />
      ),
    },
  ]
}
