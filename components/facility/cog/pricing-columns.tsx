"use client"

import type { ColumnDef } from "@tanstack/react-table"
import type { PricingFile } from "@prisma/client"
import { Badge } from "@/components/ui/badge"
import { formatCurrency } from "@/lib/formatting"

type PricingFileWithVendor = PricingFile & {
  vendor: { id: string; name: string }
}

export function getPricingColumns(): ColumnDef<PricingFileWithVendor>[] {
  return [
    {
      accessorKey: "vendorItemNo",
      header: "Item #",
      cell: ({ row }) => (
        <span className="font-mono text-xs">{row.original.vendorItemNo}</span>
      ),
    },
    {
      accessorKey: "productDescription",
      header: "Description",
      cell: ({ row }) => (
        <span
          className="max-w-[200px] truncate block font-medium"
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
        <span className="text-right">
          {row.original.listPrice
            ? formatCurrency(Number(row.original.listPrice), true)
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
            ? formatCurrency(Number(row.original.contractPrice), true)
            : "\u2014"}
        </span>
      ),
    },
  ]
}
