"use client"

import type { ColumnDef } from "@tanstack/react-table"
import type { COGRecord, COGMatchStatus } from "@prisma/client"
import { Badge } from "@/components/ui/badge"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { formatCurrency, formatCalendarDate } from "@/lib/formatting"
import { TableActionMenu } from "@/components/shared/tables/table-action-menu"
import { Edit, HelpCircle, StickyNote, Trash2 } from "lucide-react"

type COGRecordWithVendor = COGRecord & {
  vendor: { id: string; name: string } | null
  _onContract?: boolean
}

// Visual vocabulary for the 6 match statuses. Colors align with the
// three-level severity map (minor / moderate / major) from the
// canonical spec (§2, §4.12 of platform-data-model reconciliation).
// `description` is the plain-English explanation surfaced in the
// column tooltip + header legend so facility users can decode the
// badge without leaving the page.
export const MATCH_STATUS_META: Record<
  COGMatchStatus,
  { label: string; description: string; className: string }
> = {
  pending: {
    label: "Pending",
    description: "Not yet analyzed (pre-enrichment).",
    className:
      "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
  },
  on_contract: {
    label: "On Contract",
    description: "Matches an active contract.",
    className:
      "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200",
  },
  off_contract_item: {
    label: "Not Priced",
    description:
      "This item is under the contract's vendor but isn't listed in the contract's pricing file. Upload pricing to mark it as On Contract.",
    className: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  },
  out_of_scope: {
    label: "Out of Scope",
    description: "Vendor isn't under any contract at all.",
    className:
      "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  },
  unknown_vendor: {
    label: "Unknown Vendor",
    description: "Vendor name couldn't be resolved to a known vendor.",
    className:
      "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
  },
  price_variance: {
    label: "Price Variance",
    description:
      "Matches a contract but the invoice price differs materially from the contract price.",
    className:
      "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  },
}

// Ordered list so the header legend renders in a stable, logical order.
const MATCH_STATUS_ORDER: COGMatchStatus[] = [
  "on_contract",
  "price_variance",
  "off_contract_item",
  "out_of_scope",
  "unknown_vendor",
  "pending",
]

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
          {formatCalendarDate(row.original.transactionDate)}
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
      // Charles W1.W-A (A1): Multiplier column — extendedPrice / (unitCost * qty).
      id: "multiplier",
      header: "Multiplier",
      cell: ({ row }) => {
        const r = row.original
        const unit = Number(r.unitCost)
        const qty = (r as COGRecordWithVendor & { quantity?: number }).quantity ?? 1
        const ext = r.extendedPrice === null || r.extendedPrice === undefined
          ? null
          : Number(r.extendedPrice)
        if (ext === null || unit === 0 || qty === 0) {
          return <span className="text-muted-foreground text-right">—</span>
        }
        const mult = ext / (unit * qty)
        const isOne = Math.abs(mult - 1) < 0.001
        return (
          <span className={`text-right tabular-nums ${isOne ? "text-muted-foreground" : "font-medium"}`}>
            {isOne ? "1.00×" : `${mult.toFixed(2)}×`}
          </span>
        )
      },
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
      // Charles 2026-04-30 bug doc: "no column that shows the 'contract'
      // price as a reference" \u2014 the Variance / Savings columns are
      // computed against the matched contract's pricing entry, but
      // there's nothing on screen to anchor what they're being compared
      // to. Show contractPrice next to Unit Price; em-dash when the row
      // didn't match a contract entry.
      id: "contractPrice",
      header: "Contract Price",
      cell: ({ row }) => {
        const raw = row.original.contractPrice
        if (raw === null || raw === undefined) {
          return <span className="text-muted-foreground text-right">\u2014</span>
        }
        return (
          <span className="text-right font-medium tabular-nums">
            {formatCurrency(Number(raw))}
          </span>
        )
      },
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
      header: () => (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex items-center gap-1 cursor-help">
                Match Status
                <HelpCircle
                  className="h-3.5 w-3.5 text-muted-foreground"
                  aria-label="Match status legend"
                />
              </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-[320px] space-y-1.5 p-3">
              <p className="font-medium text-xs">Match status meanings</p>
              <ul className="space-y-1 text-xs">
                {MATCH_STATUS_ORDER.map((key) => {
                  const meta = MATCH_STATUS_META[key]
                  return (
                    <li key={key} className="flex gap-2">
                      <span className="font-medium whitespace-nowrap">
                        {meta.label}:
                      </span>
                      <span className="text-muted-foreground">
                        {meta.description}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ),
      cell: ({ row }) => {
        const status = row.original.matchStatus as COGMatchStatus | undefined
        // Fall back to legacy on-contract heuristic for rows not yet
        // enriched (e.g. schema-new but matchStatus still `pending`).
        let resolved: COGMatchStatus
        if (!status || status === "pending") {
          const onContract =
            row.original._onContract ??
            (row.original.category && row.original.category !== "")
          resolved = onContract ? "on_contract" : "pending"
        } else {
          resolved = status
        }
        const meta = MATCH_STATUS_META[resolved]
        return (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge className={`${meta.className} cursor-help`}>
                  {meta.label}
                </Badge>
              </TooltipTrigger>
              <TooltipContent className="max-w-[260px]">
                {meta.description}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )
      },
    },
    {
      accessorKey: "notes",
      header: () => <span className="sr-only">Notes</span>,
      cell: ({ row }) => {
        const notes = row.original.notes
        if (!notes) return null
        return (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="inline-flex items-center text-muted-foreground hover:text-foreground"
                  aria-label="View notes"
                >
                  <StickyNote className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-[320px] whitespace-pre-wrap">
                {notes}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )
      },
      size: 40,
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
