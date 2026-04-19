"use client"

import Link from "next/link"
import type { ColumnDef } from "@tanstack/react-table"
import type { Contract, Vendor, ProductCategory, Facility } from "@prisma/client"
import { ArrowUpDown, MoreHorizontal, Eye, Pencil, Trash2 } from "lucide-react"
import { formatCurrency, formatDate } from "@/lib/formatting"
import { contractStatusConfig } from "@/lib/constants"
import { StatusBadge } from "@/components/shared/badges/status-badge"
import { ScoreBadge } from "@/components/shared/badges/score-badge"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

type ContractWithVendor = Contract & {
  vendor: Pick<Vendor, "id" | "name" | "logoUrl">
  productCategory: Pick<ProductCategory, "id" | "name"> | null
  facility: Pick<Facility, "id" | "name"> | null
  rebateEarned?: number
  rebateCollected?: number
  /** From getContractMetricsBatch (when loaded). */
  metricsSpend?: number
  metricsRebate?: number
  /** Optional: when `getContracts` selects `_count.contractFacilities`. */
  _count?: { contractFacilities?: number }
  /** Optional: when the join is included directly. */
  contractFacilities?: { id: string }[]
}

const typeLabels: Record<string, string> = {
  usage: "Usage",
  pricing_only: "Pricing Only",
  capital: "Capital",
  service: "Service",
  tie_in: "Tie-In",
  grouped: "Grouped",
}

interface ColumnActions {
  onView: (id: string) => void
  onEdit: (id: string) => void
  onDelete: (contract: ContractWithVendor) => void
}

function SortableHeader({
  label,
  column,
  align = "left",
}: {
  label: string
  column: {
    getIsSorted: () => false | "asc" | "desc"
    toggleSorting: (desc?: boolean) => void
  }
  align?: "left" | "right"
}) {
  const sorted = column.getIsSorted()
  return (
    <button
      type="button"
      onClick={() => column.toggleSorting(sorted === "asc")}
      className={`inline-flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground ${
        align === "right" ? "w-full justify-end" : ""
      }`}
      aria-label={`Sort by ${label}`}
    >
      {label}
      <ArrowUpDown
        className={`h-3 w-3 ${
          sorted ? "text-foreground" : "text-muted-foreground/50"
        }`}
      />
    </button>
  )
}

export function getContractColumns(
  actions: ColumnActions
): ColumnDef<ContractWithVendor>[] {
  return [
    {
      accessorKey: "name",
      header: ({ column }) => (
        <SortableHeader label="Contract Name" column={column} />
      ),
      enableSorting: true,
      cell: ({ row }) => (
        <Link
          href={`/dashboard/contracts/${row.original.id}`}
          className="block hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="font-semibold">{row.original.name}</div>
          <div className="text-xs text-muted-foreground">
            {row.original.contractNumber || row.original.id}
          </div>
        </Link>
      ),
    },
    {
      accessorKey: "facility.name",
      header: ({ column }) => (
        <SortableHeader label="Facility" column={column} />
      ),
      accessorFn: (row) => row.facility?.name ?? "All Facilities",
      cell: ({ row }) => row.original.facility?.name ?? "All Facilities",
      enableSorting: true,
    },
    {
      accessorKey: "vendor.name",
      header: ({ column }) => (
        <SortableHeader label="Vendor" column={column} />
      ),
      accessorFn: (row) => row.vendor.name,
      enableSorting: true,
    },
    {
      id: "scope",
      header: "Scope",
      cell: ({ row }) => {
        const c = row.original
        const facilityCount =
          c._count?.contractFacilities ?? c.contractFacilities?.length ?? 0
        const label = c.isGrouped
          ? "Grouped"
          : c.isMultiFacility
            ? "Multi-facility"
            : facilityCount > 1
              ? "Shared"
              : "Single"
        const variant: "default" | "secondary" | "outline" =
          label === "Grouped" || label === "Multi-facility"
            ? "default"
            : label === "Shared"
              ? "secondary"
              : "outline"
        return <Badge variant={variant}>{label}</Badge>
      },
    },
    {
      accessorKey: "contractType",
      header: "Type",
      cell: ({ row }) => (
        <Badge variant="outline">
          {typeLabels[row.original.contractType] || "Usage"}
        </Badge>
      ),
    },
    {
      accessorKey: "status",
      header: ({ column }) => (
        <SortableHeader label="Status" column={column} />
      ),
      enableSorting: true,
      cell: ({ row }) => (
        <StatusBadge
          status={row.original.status}
          config={contractStatusConfig}
        />
      ),
    },
    {
      id: "score",
      accessorFn: (row) =>
        row.score ??
        ("aiScore" in row
          ? ((row as Record<string, unknown>).aiScore as number | null)
          : null) ??
        -1,
      header: ({ column }) => (
        <SortableHeader label="Score" column={column} />
      ),
      enableSorting: true,
      cell: ({ row }) => (
        <ScoreBadge
          // Prefer the new Contract.score column; fall back to the
          // legacy aiScore field for older rows that haven't been
          // recomputed yet.
          score={
            row.original.score ??
            ("aiScore" in row.original
              ? ((row.original as Record<string, unknown>).aiScore as
                  | number
                  | null)
              : null)
          }
          size="sm"
        />
      ),
    },
    {
      accessorKey: "effectiveDate",
      header: ({ column }) => (
        <SortableHeader label="Effective" column={column} />
      ),
      enableSorting: true,
      cell: ({ row }) => formatDate(row.original.effectiveDate),
    },
    {
      accessorKey: "expirationDate",
      header: ({ column }) => (
        <SortableHeader label="Expires" column={column} />
      ),
      enableSorting: true,
      cell: ({ row }) => formatDate(row.original.expirationDate),
    },
    {
      accessorKey: "totalValue",
      header: ({ column }) => (
        <SortableHeader label="Total Value" column={column} align="right" />
      ),
      enableSorting: true,
      cell: ({ row }) => (
        <div className="text-right font-medium">
          {formatCurrency(Number(row.original.totalValue))}
        </div>
      ),
    },
    {
      id: "metricsSpend",
      accessorFn: (row) => row.metricsSpend ?? 0,
      header: ({ column }) => (
        <SortableHeader label="Spend" column={column} align="right" />
      ),
      enableSorting: true,
      cell: ({ row }) => (
        <div className="text-right font-medium text-muted-foreground">
          {row.original.metricsSpend !== undefined
            ? formatCurrency(row.original.metricsSpend)
            : "—"}
        </div>
      ),
    },
    {
      id: "rebateEarned",
      accessorFn: (row) => row.metricsRebate ?? Number(row.rebateEarned ?? 0),
      header: ({ column }) => (
        <SortableHeader label="Rebate Earned" column={column} align="right" />
      ),
      enableSorting: true,
      cell: ({ row }) => {
        // Prefer the live metrics rebate (from getContractMetricsBatch)
        // when present; fall back to the rebateEarned aggregate.
        const value =
          row.original.metricsRebate ??
          Number(row.original.rebateEarned ?? 0)
        return (
          <div className="text-right font-medium text-green-600 dark:text-green-400">
            {formatCurrency(value)}
          </div>
        )
      },
    },
    {
      id: "actions",
      header: () => <span className="sr-only">Actions</span>,
      cell: ({ row }) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation()
                actions.onView(row.original.id)
              }}
            >
              <Eye className="mr-2 h-4 w-4" />
              View Details
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation()
                actions.onEdit(row.original.id)
              }}
            >
              <Pencil className="mr-2 h-4 w-4" />
              Edit
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-red-600 dark:text-red-400"
              onClick={(e) => {
                e.stopPropagation()
                actions.onDelete(row.original)
              }}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ]
}
