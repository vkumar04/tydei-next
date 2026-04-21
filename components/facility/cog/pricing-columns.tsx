"use client"

import type { ColumnDef } from "@tanstack/react-table"
import type { PricingFile } from "@prisma/client"
import { Loader2, Trash2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { formatCurrency } from "@/lib/formatting"

type PricingFileWithVendor = PricingFile & {
  vendor: { id: string; name: string }
}

export interface PricingColumnOptions {
  onDelete?: (id: string) => void
  pendingDeleteId?: string | null
}

export function getPricingColumns(
  options: PricingColumnOptions = {},
): ColumnDef<PricingFileWithVendor>[] {
  const { onDelete, pendingDeleteId } = options
  return [
    {
      accessorKey: "vendorItemNo",
      header: "Vendor Item #",
      cell: ({ row }) => (
        <span className="font-mono text-sm">{row.original.vendorItemNo}</span>
      ),
    },
    {
      accessorKey: "productDescription",
      header: "Description",
      cell: ({ row }) => (
        <span
          className="max-w-[200px] truncate block"
          title={row.original.productDescription}
        >
          {row.original.productDescription}
        </span>
      ),
    },
    {
      accessorKey: "vendor.name",
      header: "Vendor",
      cell: ({ row }) => row.original.vendor.name,
    },
    {
      accessorKey: "category",
      header: "Category",
      cell: ({ row }) =>
        row.original.category ? (
          <Badge variant="outline">{row.original.category}</Badge>
        ) : (
          <span className="text-muted-foreground">{"\u2014"}</span>
        ),
    },
    {
      accessorKey: "listPrice",
      header: "List Price",
      cell: ({ row }) => (
        <span className="text-right text-muted-foreground">
          {row.original.listPrice
            ? formatCurrency(Number(row.original.listPrice))
            : "\u2014"}
        </span>
      ),
    },
    {
      accessorKey: "contractPrice",
      header: "Contract Price",
      cell: ({ row }) => (
        <span className="text-right font-medium">
          {row.original.contractPrice
            ? formatCurrency(Number(row.original.contractPrice))
            : "\u2014"}
        </span>
      ),
    },
    {
      id: "savings",
      header: "Savings",
      cell: ({ row }) => {
        const list = Number(row.original.listPrice ?? 0)
        const contract = Number(row.original.contractPrice ?? 0)
        const savings = list - contract
        const pct = list > 0 ? ((savings / list) * 100).toFixed(0) : "0"
        return (
          <span className="text-right text-green-600 dark:text-green-400">
            {formatCurrency(savings)} ({pct}%)
          </span>
        )
      },
    },
    {
      // Charles iMessage 2026-04-20 N17: per-SKU carve-out %. Rendered
      // as the stored fraction × 100 for readability (0.03 → "3.00%").
      // Empty when null (no carve-out for this SKU).
      id: "carveOutPercent",
      header: "Carve-Out",
      cell: ({ row }) => {
        const raw = (row.original as { carveOutPercent?: number | string | null })
          .carveOutPercent
        if (raw == null) return <span className="text-muted-foreground">{"\u2014"}</span>
        const pct = Number(raw) * 100
        return (
          <span className="text-right font-medium text-blue-600 dark:text-blue-400">
            {pct.toFixed(2)}%
          </span>
        )
      },
    },
    {
      id: "source",
      header: "Source",
      cell: () => (
        <div className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-green-100 dark:bg-green-900/50 text-green-700 dark:text-green-300 text-xs">
          File
        </div>
      ),
    },
    ...(onDelete
      ? [
          {
            id: "actions",
            header: "",
            cell: ({ row }) => {
              const busy = pendingDeleteId === row.original.id
              return (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Delete pricing row"
                  className="h-8 w-8 text-destructive hover:text-destructive"
                  onClick={(e) => {
                    e.stopPropagation()
                    onDelete(row.original.id)
                  }}
                  disabled={busy}
                >
                  {busy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                </Button>
              )
            },
          } satisfies ColumnDef<PricingFileWithVendor>,
        ]
      : []),
  ]
}
