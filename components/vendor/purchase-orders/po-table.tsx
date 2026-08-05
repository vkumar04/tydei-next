import { useMemo } from "react"
import type { ColumnDef } from "@/components/shared/tables/table-features"
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
import { MoreHorizontal, Eye, Building2 } from "lucide-react"
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
        header: "PO Number",
        meta: { filterVariant: "text", filterLabel: "PO Number" },
        cell: ({ row }) => <span className="font-medium">{row.original.poNumber}</span>,
      },
      {
        accessorKey: "facilityName",
        header: "Facility",
        meta: { filterVariant: "select", filterLabel: "Facility" },
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-muted-foreground" />
            {row.original.facilityName}
          </div>
        ),
      },
      {
        accessorKey: "poType",
        header: "Type",
        meta: { filterVariant: "select", filterLabel: "Type" },
        cell: ({ row }) => <span className="text-sm">{row.original.poType}</span>,
      },
      {
        accessorKey: "status",
        header: "Status",
        meta: { filterVariant: "select", filterLabel: "Status" },
        cell: ({ row }) => {
          const s = row.original.status
          const config = poStatusConfig[s] ?? { label: s, color: "bg-muted text-muted-foreground" }
          return <Badge className={config.color}>{config.label}</Badge>
        },
      },
      {
        accessorKey: "itemCount",
        header: "Items",
        meta: { filterVariant: "range", filterLabel: "Items" },
        cell: ({ row }) => <span className="text-sm">{row.original.itemCount}</span>,
      },
      {
        accessorKey: "totalCost",
        header: "Amount",
        meta: { filterVariant: "range", filterLabel: "Amount" },
        cell: ({ row }) => (
          <span className="font-semibold">{formatCurrency(row.original.totalCost)}</span>
        ),
      },
      {
        accessorKey: "receivedDate",
        meta: { filterVariant: "none" },
        // L16: only populated when the PO is completed, and it's the
        // completion timestamp (updatedAt), not a delivery receipt —
        // labeled honestly. As a real timestamp it keeps the local-tz
        // formatDate (formatCalendarDate is only for @db.Date columns).
        header: "Completed",
        cell: ({ row }) =>
          row.original.receivedDate ? formatDate(row.original.receivedDate) : "—",
      },
      {
        id: "actions",
        meta: { filterVariant: "none" },
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
      enableColumnFilters
      onRowClick={(row) => onViewPO(row)}
    />
  )
}
