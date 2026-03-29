"use client"

import { useState, useMemo } from "react"
import { usePricingFiles } from "@/hooks/use-pricing-files"
import { useVendorList } from "@/hooks/use-vendor-crud"
import { getPricingColumns } from "@/components/facility/cog/pricing-columns"
import { DataTable } from "@/components/shared/tables/data-table"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

interface PricingFilesTableProps {
  facilityId: string
}

export function PricingFilesTable({ facilityId }: PricingFilesTableProps) {
  const [vendorFilter, setVendorFilter] = useState<string>("")

  const { data, isLoading } = usePricingFiles(
    facilityId,
    vendorFilter || undefined
  )
  const { data: vendorData } = useVendorList()
  const columns = useMemo(() => getPricingColumns(), [])

  return (
    <div className="space-y-4">
      <DataTable
        columns={columns}
        data={data?.files ?? []}
        searchKey="productDescription"
        searchPlaceholder="Search items, SKUs..."
        isLoading={isLoading}
        filterComponent={
          <Select value={vendorFilter} onValueChange={setVendorFilter}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="All vendors" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All vendors</SelectItem>
              {vendorData?.vendors.map((v) => (
                <SelectItem key={v.id} value={v.id}>
                  {v.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />
    </div>
  )
}
