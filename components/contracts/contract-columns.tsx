"use client"

import Link from "next/link"
import type { ColumnDef } from "@tanstack/react-table"
import type { Contract, Vendor, ProductCategory, Facility } from "@prisma/client"
import { MoreHorizontal, Eye, Pencil, Trash2 } from "lucide-react"
import { formatCurrency, formatDate } from "@/lib/formatting"
import { contractStatusConfig } from "@/lib/constants"
import { StatusBadge } from "@/components/shared/badges/status-badge"
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

export function getContractColumns(
  actions: ColumnActions
): ColumnDef<ContractWithVendor>[] {
  return [
    {
      accessorKey: "name",
      header: "Contract Name",
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
      header: "Facility",
      accessorFn: (row) => row.facility?.name ?? "All Facilities",
      cell: ({ row }) => row.original.facility?.name ?? "All Facilities",
    },
    {
      accessorKey: "vendor.name",
      header: "Vendor",
      accessorFn: (row) => row.vendor.name,
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
      accessorKey: "isMultiFacility",
      header: "Scope",
      cell: ({ row }) => (
        <span className="capitalize">
          {row.original.isMultiFacility ? "Multi" : "Single"}
        </span>
      ),
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => (
        <StatusBadge
          status={row.original.status}
          config={contractStatusConfig}
        />
      ),
    },
    {
      accessorKey: "effectiveDate",
      header: "Effective",
      cell: ({ row }) => formatDate(row.original.effectiveDate),
    },
    {
      accessorKey: "expirationDate",
      header: "Expires",
      cell: ({ row }) => formatDate(row.original.expirationDate),
    },
    {
      accessorKey: "totalValue",
      header: () => <div className="text-right">Total Value</div>,
      cell: ({ row }) => (
        <div className="text-right font-medium">
          {formatCurrency(Number(row.original.totalValue))}
        </div>
      ),
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
              className="text-red-600"
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
