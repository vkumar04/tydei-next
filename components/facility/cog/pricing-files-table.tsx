"use client"

import { useState, useMemo } from "react"
import { Upload } from "lucide-react"
import { usePricingFiles } from "@/hooks/use-pricing-files"
import { useVendorList } from "@/hooks/use-vendor-crud"
import { getPricingColumns } from "@/components/facility/cog/pricing-columns"
import { PricingImportDialog } from "@/components/facility/cog/pricing-import-dialog"
import { DataTable } from "@/components/shared/tables/data-table"
import { Button } from "@/components/ui/button"
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
  const [importOpen, setImportOpen] = useState(false)

  const { data, isLoading, refetch } = usePricingFiles(
    facilityId,
    vendorFilter || undefined
  )
  const { data: vendorData } = useVendorList()
  const columns = useMemo(() => getPricingColumns(), [])

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={() => setImportOpen(true)}>
          <Upload className="size-4" /> Import Pricing File
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={data?.files ?? []}
        searchKey="productDescription"
        searchPlaceholder="Search pricing files..."
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

      <PricingImportDialog
        facilityId={facilityId}
        open={importOpen}
        onOpenChange={setImportOpen}
        onComplete={() => refetch()}
      />
    </div>
  )
}
