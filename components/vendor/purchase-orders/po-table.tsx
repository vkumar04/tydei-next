import { useMemo } from "react"
import type { ColumnDef } from "@tanstack/react-table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { DataTable } from "@/components/shared/tables/data-table"
import { formatCurrency, formatDate } from "@/lib/formatting"
import { MoreHorizontal, Eye, Download, Building2 } from "lucide-react"
import { poStatusConfig } from "./types"
import type { VendorPORow } from "./types"

export interface POTableProps {
  data: VendorPORow[]
  isLoading: boolean
  onViewPO: (po: VendorPORow) => void
}

export function POTable({ data, isLoading, onViewPO }: POTableProps) {
  const columns: ColumnDef<VendorPORow>[] = useMemo(
    () => [
      {
        accessorKey: "poNumber",
        header: "PO #",
        cell: ({ row }) => <span className="font-medium">{row.original.poNumber}</span>,
      },
      {
        accessorKey: "facilityName",
        header: "Facility",
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-muted-foreground" />
            {row.original.facilityName}
          </div>
        ),
      },
      {
        accessorKey: "orderDate",
        header: "Order Date",
        cell: ({ row }) => formatDate(row.original.orderDate),
      },
      {
        accessorKey: "totalCost",
        header: "Total",
        cell: ({ row }) => (
          <span className="font-semibold">{formatCurrency(row.original.totalCost)}</span>
        ),
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => {
          const s = row.original.status
          const config = poStatusConfig[s] ?? { label: s, color: "bg-gray-100 text-gray-700" }
          return <Badge className={config.color}>{config.label}</Badge>
        },
      },
      {
        id: "actions",
        cell: ({ row }) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" onClick={(e) => e.stopPropagation()}>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation()
                  onViewPO(row.original)
                }}
              >
                <Eye className="mr-2 h-4 w-4" />
                View Details
              </DropdownMenuItem>
              <DropdownMenuItem>
                <Download className="mr-2 h-4 w-4" />
                Download PDF
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ],
    [onViewPO]
  )

  return (
    <DataTable
      columns={columns}
      data={data}
      searchKey="poNumber"
      searchPlaceholder="Search orders..."
      isLoading={isLoading}
      onRowClick={(row) => onViewPO(row)}
    />
  )
}
