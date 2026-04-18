"use client"

import type { ColumnDef } from "@tanstack/react-table"
import type { COGRecord, COGMatchStatus } from "@prisma/client"
import { Badge } from "@/components/ui/badge"
import { formatCurrency, formatDate } from "@/lib/formatting"
import { TableActionMenu } from "@/components/shared/tables/table-action-menu"
import { Edit, Trash2 } from "lucide-react"

type COGRecordWithVendor = COGRecord & {
  vendor: { id: string; name: string } | null
  _onContract?: boolean
}

// Visual vocabulary for the 6 match statuses. Colors align with the
// three-level severity map (minor / moderate / major) from the
// canonical spec (§2, §4.12 of platform-data-model reconciliation).
export const MATCH_STATUS_META: Record<
  COGMatchStatus,
  { label: string; className: string }
> = {
  pending: {
    label: "Pending",
    className:
      "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
  },
  on_contract: {
    label: "On Contract",
    className:
      "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200",
  },
  off_contract_item: {
    label: "Off Contract",
    className: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  },
  out_of_scope: {
    label: "Out of Scope",
    className:
      "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  },
  unknown_vendor: {
    label: "Unknown Vendor",
    className:
      "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
  },
  price_variance: {
    label: "Price Variance",
    className:
      "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  },
}

// Variance severity ramp — matches §4.12 of platform-data-model.
// 0-2% = minor (muted), 2-10% = moderate (amber), ≥10% = major (red).
const varianceClass = (variance: number | null): string => {
  if (variance === null) return "text-muted-foreground"
  const abs = Math.abs(variance)
  if (abs < 2) return "text-muted-foreground"
  if (abs < 10) return "text-amber-600 dark:text-amber-400"
  return "text-red-600 dark:text-red-400"
}

interface COGColumnOptions {
  onDelete: (record: COGRecordWithVendor) => void
  onEdit: (record: COGRecordWithVendor) => void
}

export function getCOGColumns({
  onDelete,
  onEdit,
}: COGColumnOptions): ColumnDef<COGRecordWithVendor>[] {
  return [
    {
      accessorKey: "poNumber",
      header: "PO #",
      cell: ({ row }) => (
        <span className="font-mono text-sm">
          {row.original.poNumber ?? "\u2014"}
        </span>
      ),
    },
    {
      accessorKey: "transactionDate",
      header: "PO Date",
      cell: ({ row }) => (
        <span className="text-muted-foreground">
          {formatDate(row.original.transactionDate)}
        </span>
      ),
    },
    {
      accessorKey: "inventoryNumber",
      header: "Item #",
      cell: ({ row }) => (
        <span className="font-mono text-sm">
          {row.original.inventoryNumber}
        </span>
      ),
    },
    {
      accessorKey: "inventoryDescription",
      header: "Description",
      cell: ({ row }) => (
        <span
          className="font-medium line-clamp-1"
          title={row.original.inventoryDescription}
        >
          {row.original.inventoryDescription}
        </span>
      ),
    },
    {
      accessorKey: "vendor.name",
      header: "Vendor",
      cell: ({ row }) =>
        row.original.vendor?.name ?? row.original.vendorName ?? "\u2014",
    },
    {
      accessorKey: "quantity",
      header: "Qty",
      cell: ({ row }) => (
        <span className="text-center">
          {(row.original as COGRecordWithVendor & { quantity?: number }).quantity ?? 1}
        </span>
      ),
    },
    {
      accessorKey: "unitCost",
      header: "Unit Price",
      cell: ({ row }) => (
        <span className="text-right font-medium">
          {formatCurrency(Number(row.original.unitCost))}
        </span>
      ),
    },
    {
      accessorKey: "extendedPrice",
      header: "Extended",
      cell: ({ row }) => (
        <span className="text-right font-medium">
          {row.original.extendedPrice
            ? formatCurrency(Number(row.original.extendedPrice))
            : "\u2014"}
        </span>
      ),
    },
    {
      id: "savings",
      header: "Savings",
      cell: ({ row }) => {
        const raw = row.original.savingsAmount
        if (raw === null || raw === undefined) {
          return <span className="text-muted-foreground">—</span>
        }
        const amount = Number(raw)
        const tone =
          amount > 0
            ? "text-emerald-600 dark:text-emerald-400"
            : amount < 0
              ? "text-red-600 dark:text-red-400"
              : "text-muted-foreground"
        return (
          <span className={`text-right font-medium tabular-nums ${tone}`}>
            {amount > 0 ? "+" : ""}
            {formatCurrency(amount)}
          </span>
        )
      },
    },
    {
      id: "variance",
      header: "Variance",
      cell: ({ row }) => {
        const raw = row.original.variancePercent
        if (raw === null || raw === undefined) {
          return <span className="text-muted-foreground">—</span>
        }
        const pct = Number(raw)
        return (
          <span
            className={`text-right font-medium tabular-nums ${varianceClass(
              pct
            )}`}
          >
            {pct > 0 ? "+" : ""}
            {pct.toFixed(1)}%
          </span>
        )
      },
    },
    {
      id: "status",
      header: "Match Status",
      cell: ({ row }) => {
        const status = row.original.matchStatus as COGMatchStatus | undefined
        // Fall back to legacy on-contract heuristic for rows not yet
        // enriched (e.g. schema-new but matchStatus still `pending`).
        if (!status || status === "pending") {
          const onContract =
            row.original._onContract ??
            (row.original.category && row.original.category !== "")
          if (onContract) {
            const meta = MATCH_STATUS_META.on_contract
            return <Badge className={meta.className}>{meta.label}</Badge>
          }
          return (
            <Badge className={MATCH_STATUS_META.pending.className}>
              {MATCH_STATUS_META.pending.label}
            </Badge>
          )
        }
        const meta = MATCH_STATUS_META[status]
        return <Badge className={meta.className}>{meta.label}</Badge>
      },
    },
    {
      id: "actions",
      cell: ({ row }) => (
        <TableActionMenu
          actions={[
            {
              label: "Edit",
              icon: Edit,
              onClick: () => onEdit(row.original),
            },
            {
              label: "Delete",
              icon: Trash2,
              onClick: () => onDelete(row.original),
              variant: "destructive",
            },
          ]}
        />
      ),
    },
  ]
}
