"use client"

import type { ColumnDef } from "@tanstack/react-table"
import type { Contract, Facility, ProductCategory } from "@prisma/client"
import { Eye } from "lucide-react"
import { formatCurrency, formatDate } from "@/lib/formatting"
import { contractStatusConfig } from "@/lib/constants"
import { StatusBadge } from "@/components/shared/badges/status-badge"
import { Button } from "@/components/ui/button"

type ContractWithFacility = Contract & {
  facility: Pick<Facility, "id" | "name"> | null
  productCategory: Pick<ProductCategory, "id" | "name"> | null
}

export function getVendorContractColumns(
  onView: (id: string) => void
): ColumnDef<ContractWithFacility>[] {
  return [
    {
      accessorKey: "name",
      header: "Name",
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
      accessorKey: "effectiveDate",
      header: "Effective",
      cell: ({ row }) => formatDate(row.original.effectiveDate),
    },
    {
      accessorKey: "expirationDate",
      header: "Expiration",
      cell: ({ row }) => formatDate(row.original.expirationDate),
    },
    {
      accessorKey: "totalValue",
      header: "Value",
      cell: ({ row }) => formatCurrency(Number(row.original.totalValue)),
    },
    {
      id: "actions",
      cell: ({ row }) => (
        <Button variant="ghost" size="icon" onClick={() => onView(row.original.id)}>
          <Eye className="size-4" />
        </Button>
      ),
    },
  ]
}
