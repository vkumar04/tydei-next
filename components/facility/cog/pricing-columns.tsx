"use client"

import type { ColumnDef } from "@tanstack/react-table"
import type { PricingFile, Vendor } from "@prisma/client"
import { formatCurrency, formatDate } from "@/lib/formatting"

type PricingFileWithVendor = PricingFile & {
  vendor: { id: string; name: string }
}

export function getPricingColumns(): ColumnDef<PricingFileWithVendor>[] {
  return [
    {
      accessorKey: "vendorItemNo",
      header: "Vendor Item No",
      cell: ({ row }) => (
        <span className="font-mono text-xs">{row.original.vendorItemNo}</span>
      ),
    },
    {
      accessorKey: "productDescription",
      header: "Description",
      cell: ({ row }) => (
        <span className="max-w-[200px] truncate block">
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
      accessorKey: "listPrice",
      header: "List Price",
      cell: ({ row }) =>
        row.original.listPrice
          ? formatCurrency(Number(row.original.listPrice), true)
          : "—",
    },
    {
      accessorKey: "contractPrice",
      header: "Contract Price",
      cell: ({ row }) =>
        row.original.contractPrice
          ? formatCurrency(Number(row.original.contractPrice), true)
          : "—",
    },
    {
      accessorKey: "effectiveDate",
      header: "Effective",
      cell: ({ row }) => formatDate(row.original.effectiveDate),
    },
    {
      accessorKey: "expirationDate",
      header: "Expires",
      cell: ({ row }) =>
        row.original.expirationDate
          ? formatDate(row.original.expirationDate)
          : "—",
    },
    {
      accessorKey: "category",
      header: "Category",
      cell: ({ row }) => row.original.category ?? "—",
    },
  ]
}
