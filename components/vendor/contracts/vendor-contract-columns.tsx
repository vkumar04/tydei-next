"use client"

import type { ColumnDef } from "@tanstack/react-table"
import type { Contract, Facility, ProductCategory } from "@/lib/generated/prisma/client"
import { Eye, MoreHorizontal, FileText, Building2, Trash2 } from "lucide-react"
import { formatCurrency, formatDate } from "@/lib/formatting"
import { contractStatusConfig } from "@/lib/constants"
import { StatusBadge } from "@/components/shared/badges/status-badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

type ContractWithFacility = Contract & {
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
      cell: ({ row }) => (
        <span className="capitalize">{row.original.contractType.replace("_", " ")}</span>
      ),
    },
    {
      accessorKey: "status",
      header: "Status",
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
      cell: ({ row }) => formatDate(row.original.lastActionAt),
    },
    {
      accessorKey: "expirationDate",
      header: "End Date",
      cell: ({ row }) => formatDate(row.original.expirationDate),
    },
    {
      accessorKey: "totalValue",
      header: "Value",
      cell: ({ row }) => formatCurrency(Number(row.original.totalValue)),
    },
    {
      id: "actions",
      header: () => <span className="sr-only">Actions</span>,
      cell: ({ row }) => {
        // Bug-bash 2026-06-11 B2: only PendingContract submissions are
        // deletable, and never an approved one (those back a live
        // Contract). Real Contract rows have no pendingStatus at all.
        const deletable =
          row.original.pendingStatus !== undefined &&
          row.original.pendingStatus !== "approved"
        return (
          <div className="text-right">
            <DropdownMenu>
              {/* stopPropagation: the row itself navigates on click
                  (B2 click-through); menu interactions must not. */}
              <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                <Button variant="ghost" size="sm">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                <DropdownMenuLabel>Actions</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation()
                    onView(row.original.id)
                  }}
                >
                  <Eye className="h-4 w-4 mr-2" />
                  View Details
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation()
                    onView(row.original.id)
                  }}
                >
                  <FileText className="h-4 w-4 mr-2" />
                  Download PDF
                </DropdownMenuItem>
                {deletable && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={(e) => {
                        e.stopPropagation()
                        onDelete({ id: row.original.id, name: row.original.name })
                      }}
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Delete
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )
      },
    },
  ]
}
