"use client"

import Link from "next/link"
import type { ColumnDef } from "@tanstack/react-table"
import type { Contract, Vendor, ProductCategory, Facility } from "@prisma/client"
import {
  ArrowUpDown,
  HelpCircle,
  MoreHorizontal,
  Eye,
  Pencil,
  Trash2,
} from "lucide-react"
import { formatCurrency, formatCalendarDate } from "@/lib/formatting"
import { contractStatusConfig } from "@/lib/constants"
import { StatusBadge } from "@/components/shared/badges/status-badge"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

type ContractWithVendor = Contract & {
  vendor: Pick<Vendor, "id" | "name" | "logoUrl">
  productCategory: Pick<ProductCategory, "id" | "name"> | null
  facility: Pick<Facility, "id" | "name"> | null
  rebateEarned?: number
  rebateCollected?: number
  /**
   * Trailing-12-month spend attached by `getContracts` (Charles W1.J).
   * Mirrors the R5.28 cascade from `getContract`:
   *   ContractPeriod → COG-by-contract → COG-by-vendor.
   * Charles W1.X-D: this is now the single source for the Spend column
   * (getContractMetricsBatch's lifetime aggregate was removed).
   */
  currentSpend?: number
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
  tooltip,
  tooltipAriaLabel,
}: {
  label: string
  column: {
    getIsSorted: () => false | "asc" | "desc"
    toggleSorting: (desc?: boolean) => void
  }
  align?: "left" | "right"
  /** Optional explanatory tooltip rendered next to the label. */
  tooltip?: string
  /** A11y label for the help trigger; defaults to `${label} help`. */
  tooltipAriaLabel?: string
}) {
  const sorted = column.getIsSorted()
  return (
    <span
      className={`inline-flex items-center gap-1 ${
        align === "right" ? "w-full justify-end" : ""
      }`}
    >
      <button
        type="button"
        onClick={() => column.toggleSorting(sorted === "asc")}
        className="inline-flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground"
        aria-label={`Sort by ${label}`}
      >
        {label}
        <ArrowUpDown
          className={`h-3 w-3 ${
            sorted ? "text-foreground" : "text-muted-foreground/50"
          }`}
        />
      </button>
      {tooltip ? (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className="inline-flex cursor-help items-center"
                onClick={(e) => e.stopPropagation()}
              >
                <HelpCircle
                  className="h-3.5 w-3.5 text-muted-foreground"
                  aria-label={tooltipAriaLabel ?? `${label} help`}
                />
              </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-[320px] p-3 text-xs">
              <p>{tooltip}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : null}
    </span>
  )
}

export function getContractColumns(
  actions: ColumnActions,
  options: { selectable?: boolean } = {}
): ColumnDef<ContractWithVendor>[] {
  const { selectable = false } = options

  const selectionColumn: ColumnDef<ContractWithVendor> = {
    id: "select",
    header: ({ table }) => (
      <Checkbox
        checked={
          table.getIsAllPageRowsSelected() ||
          (table.getIsSomePageRowsSelected() && "indeterminate")
        }
        onCheckedChange={(v) => table.toggleAllPageRowsSelected(!!v)}
        aria-label="Select all"
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        checked={row.getIsSelected()}
        onCheckedChange={(v) => row.toggleSelected(!!v)}
        onClick={(e) => e.stopPropagation()}
        aria-label="Select row"
      />
    ),
    enableSorting: false,
    enableHiding: false,
  }

  const columns: ColumnDef<ContractWithVendor>[] = [
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
    // Score column removed 2026-04-23 (Bug 15) — Charles: "What is this
    // score based on? Not sure we need that." The underlying
    // Contract.score value is still computed server-side and remains
    // available on the detail page's radar chart; dropping it from the
    // list column keeps the grade out of the primary surface where
    // its provenance was unclear.
    {
      accessorKey: "effectiveDate",
      header: ({ column }) => (
        <SortableHeader label="Effective" column={column} />
      ),
      enableSorting: true,
      cell: ({ row }) => formatCalendarDate(row.original.effectiveDate),
    },
    {
      accessorKey: "expirationDate",
      header: ({ column }) => (
        <SortableHeader label="Expires" column={column} />
      ),
      enableSorting: true,
      cell: ({ row }) => formatCalendarDate(row.original.expirationDate),
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
      id: "currentSpend",
      // Charles W1.X-D: single source. `currentSpend` is populated by
      // `getContracts` via the R5.28 trailing-12mo cascade; the old
      // `?? metricsSpend` fallback (from getContractMetricsBatch) was
      // shadowing the canonical value and drove the list-vs-detail drift
      // Charles reported on 2026-04-20.
      accessorFn: (row) => row.currentSpend ?? 0,
      header: ({ column }) => (
        <SortableHeader
          label="Spend (Last 12 Months)"
          column={column}
          align="right"
          tooltip="Trailing 12 months of recorded activity. Sourced from ContractPeriod rollups, then COG records tagged to this contract, then COG records for this vendor (fuzzy — contracts sharing a vendor may share the same vendor-window figure)."
          tooltipAriaLabel="Spend (Last 12 Months) help"
        />
      ),
      enableSorting: true,
      cell: ({ row }) => {
        const value = row.original.currentSpend
        return (
          <div className="text-right font-medium text-muted-foreground">
            {value !== undefined ? formatCurrency(value) : "—"}
          </div>
        )
      },
    },
    {
      id: "rebateEarned",
      // Charles W1.X-D: single source. `rebateEarned` is the canonical
      // figure from `getContracts`. Charles iMessage 2026-04-20 N13:
      // the list column now reads LIFETIME (via `sumEarnedRebatesLifetime`
      // in lib/actions/contracts.ts) because many rebates earn on the
      // last day of the year and a YTD column underrepresented small
      // contracts. Contract detail still carries a YTD card for
      // compliance reporting.
      accessorFn: (row) => Number(row.rebateEarned ?? 0),
      header: ({ column }) => (
        <SortableHeader
          label="Rebate Earned (Lifetime)"
          column={column}
          align="right"
          tooltip="Earned across every closed rebate period on this contract (Charles iMessage 2026-04-20 N13). 'Closed' means the period's end date has passed. Contract detail still shows a YTD card for compliance."
          tooltipAriaLabel="Rebate Earned (Lifetime) help"
        />
      ),
      enableSorting: true,
      cell: ({ row }) => {
        const value = Number(row.original.rebateEarned ?? 0)
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

  return selectable ? [selectionColumn, ...columns] : columns
}
