"use client"

import type { ColumnDef } from "@tanstack/react-table"
import type { Contract, Facility, ProductCategory } from "@/lib/generated/prisma/client"
import { Eye, FileText, Building2, Trash2 } from "lucide-react"
import { formatCurrency, formatDate } from "@/lib/formatting"
import { contractStatusConfig } from "@/lib/constants"
import { StatusBadge } from "@/components/shared/badges/status-badge"
import { TableActionMenu } from "@/components/shared/tables/table-action-menu"

export type ContractWithFacility = Contract & {
  facility: Pick<Facility, "id" | "name"> | null
  productCategory: Pick<ProductCategory, "id" | "name"> | null
  /**
   * Present ONLY on rows mapped from PendingContract submissions
   * (vendor-contract-list.tsx mappedPending). Real Contract rows —
   * including active ones — never carry it, which is what gates the
   * Delete action below (bug-bash 2026-06-11 B2: active contracts are
   * NEVER deletable).
   */
  pendingStatus?: string
  /**
   * When the row's status last changed (bugs.rtfd 2026-06-11 B4).
   * Resolved at the mapping boundary in vendor-contract-list.tsx via
   * `resolveLastActionAt`: pending rows `reviewedAt ?? submittedAt`,
   * real Contract rows `updatedAt`.
   */
  lastActionAt?: Date | null
}

export function getVendorContractColumns(
  onView: (id: string) => void,
  onDelete: (row: { id: string; name: string }) => void
): ColumnDef<ContractWithFacility>[] {
  return [
    {
      accessorKey: "name",
      header: "Contract Name",
      meta: { filterVariant: "text", filterLabel: "Name" },
      cell: ({ row }) => (
        <div>
          <p className="font-medium">{row.original.name}</p>
          {row.original.contractNumber && (
            <p className="text-xs text-muted-foreground">{row.original.contractNumber}</p>
          )}
        </div>
      ),
    },
    {
      accessorKey: "facility.name",
      header: "Facility",
      meta: { filterVariant: "select", filterLabel: "Facility" },
      accessorFn: (row) => row.facility?.name ?? "N/A",
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <Building2 className="h-4 w-4 text-muted-foreground" />
          {row.original.facility?.name ?? "N/A"}
        </div>
      ),
    },
    {
      accessorKey: "contractType",
      header: "Type",
      meta: { filterVariant: "select", filterLabel: "Type" },
      cell: ({ row }) => (
        <span className="capitalize">{row.original.contractType.replace("_", " ")}</span>
      ),
    },
    {
      accessorKey: "status",
      header: "Status",
      meta: { filterVariant: "select", filterLabel: "Status" },
      cell: ({ row }) => (
        <StatusBadge status={row.original.status} config={contractStatusConfig} />
      ),
    },
    {
      // bugs.rtfd 2026-06-11 B4: when the row's status last changed —
      // resolved upstream in vendor-contract-list.tsx (resolveLastActionAt),
      // never computed here.
      accessorKey: "lastActionAt",
      header: "Last Action",
      meta: { filterVariant: "none" },
      cell: ({ row }) => formatDate(row.original.lastActionAt),
    },
    {
      accessorKey: "expirationDate",
      header: "End Date",
      meta: { filterVariant: "none" },
      cell: ({ row }) => formatDate(row.original.expirationDate),
    },
    {
      accessorKey: "totalValue",
      header: "Value",
      meta: { filterVariant: "range", filterLabel: "Value" },
      accessorFn: (row) => Number(row.totalValue),
      cell: ({ row }) => formatCurrency(Number(row.original.totalValue)),
    },
    {
      id: "actions",
      header: () => <span className="sr-only">Actions</span>,
      meta: { filterVariant: "none" },
      cell: ({ row }) => {
        // Bug-bash 2026-06-11 B2: only PendingContract submissions are
        // deletable, and never an approved one (those back a live
        // Contract). Real Contract rows have no pendingStatus at all.
        const deletable =
          row.original.pendingStatus !== undefined &&
          row.original.pendingStatus !== "approved"
        // stopPropagation: the row itself navigates on click (B2
        // click-through); menu interactions must not.
        return (
          <div className="text-right">
            <TableActionMenu
              stopPropagation
              triggerSize="sm"
              label="Actions"
              actions={[
                {
                  label: "View Details",
                  icon: Eye,
                  onClick: () => onView(row.original.id),
                },
                {
                  label: "Download PDF",
                  icon: FileText,
                  onClick: () => onView(row.original.id),
                },
                ...(deletable
                  ? [
                      {
                        label: "Delete",
                        icon: Trash2,
                        variant: "destructive" as const,
                        separatorBefore: true,
                        onClick: () =>
                          onDelete({
                            id: row.original.id,
                            name: row.original.name,
                          }),
                      },
                    ]
                  : []),
              ]}
            />
          </div>
        )
      },
    },
  ]
}
