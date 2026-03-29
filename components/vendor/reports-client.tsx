"use client"

import { useQuery } from "@tanstack/react-query"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { DataTable } from "@/components/shared/tables/data-table"
import { formatCurrency } from "@/lib/formatting"
import type { ColumnDef } from "@tanstack/react-table"
import { getVendorReportData, type VendorContractReport } from "@/lib/actions/vendor-reports"

const columns: ColumnDef<VendorContractReport>[] = [
  { accessorKey: "name", header: "Contract" },
  { accessorKey: "facilityName", header: "Facility" },
  { accessorKey: "totalSpend", header: "Total Spend", cell: ({ row }) => formatCurrency(row.original.totalSpend) },
  { accessorKey: "rebateEarned", header: "Rebate Earned", cell: ({ row }) => formatCurrency(row.original.rebateEarned) },
  { accessorKey: "status", header: "Status" },
]

interface VendorReportsClientProps {
  vendorId: string
}

export function VendorReportsClient({ vendorId }: VendorReportsClientProps) {
  const { data, isLoading } = useQuery({
    queryKey: ["vendorReports", vendorId],
    queryFn: () => getVendorReportData(vendorId),
  })

  return (
    <Tabs defaultValue="contracts">
      <TabsList>
        <TabsTrigger value="contracts">Contract Performance</TabsTrigger>
      </TabsList>
      <TabsContent value="contracts" className="mt-4">
        <DataTable columns={columns} data={data ?? []} searchKey="name" searchPlaceholder="Search contracts..." isLoading={isLoading} />
      </TabsContent>
    </Tabs>
  )
}
