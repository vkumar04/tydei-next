"use client"

import type { ColumnDef } from "@tanstack/react-table"
import type { Contract, Facility, ProductCategory } from "@prisma/client"
import { Eye, MoreHorizontal, FileText, Building2 } from "lucide-react"
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
}

export function getVendorContractColumns(
  onView: (id: string) => void
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
      header: () => <span className="sr-only">Actions</span>,
      cell: ({ row }) => (
        <div className="text-right">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Actions</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => onView(row.original.id)}>
                <Eye className="h-4 w-4 mr-2" />
                View Details
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onView(row.original.id)}>
                <FileText className="h-4 w-4 mr-2" />
                Download PDF
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ),
    },
  ]
}
