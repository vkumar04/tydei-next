"use client"

import { useQuery } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { Badge } from "@/components/ui/badge"
import { DataTable } from "@/components/shared/tables/data-table"
import { formatCurrency, formatDate } from "@/lib/formatting"
import { getVendorPurchaseOrders, type VendorPORow } from "@/lib/actions/vendor-purchase-orders"

const columns: ColumnDef<VendorPORow>[] = [
  { accessorKey: "poNumber", header: "PO #" },
  { accessorKey: "facilityName", header: "Facility" },
  { accessorKey: "orderDate", header: "Order Date", cell: ({ row }) => formatDate(row.original.orderDate) },
  { accessorKey: "totalCost", header: "Total", cell: ({ row }) => formatCurrency(row.original.totalCost) },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => <Badge variant="outline" className="capitalize">{row.original.status}</Badge>,
  },
]

interface VendorPurchaseOrdersClientProps {
  vendorId: string
}

export function VendorPurchaseOrdersClient({ vendorId }: VendorPurchaseOrdersClientProps) {
  const { data, isLoading } = useQuery({
    queryKey: ["vendorPOs", vendorId],
    queryFn: () => getVendorPurchaseOrders(vendorId),
  })

  return <DataTable columns={columns} data={data ?? []} searchKey="poNumber" searchPlaceholder="Search POs..." isLoading={isLoading} />
}
