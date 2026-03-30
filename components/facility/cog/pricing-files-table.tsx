"use client"

import { useState, useMemo } from "react"
import { Download, Plus, List } from "lucide-react"
import { usePricingFiles } from "@/hooks/use-pricing-files"
import { useVendorList } from "@/hooks/use-vendor-crud"
import { getPricingColumns } from "@/components/facility/cog/pricing-columns"
import { DataTable } from "@/components/shared/tables/data-table"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
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
  const [categoryFilter, setCategoryFilter] = useState<string>("all")

  const { data, isLoading } = usePricingFiles(
    facilityId,
    vendorFilter || undefined
  )
  const { data: vendorData } = useVendorList()
  const columns = useMemo(() => getPricingColumns(), [])

  const files = data?.files ?? []

  // Derive unique categories from data
  const categories = useMemo(() => {
    const cats = new Set(files.map((f) => f.category).filter(Boolean))
    return Array.from(cats) as string[]
  }, [files])

  // Filter by category client-side
  const filteredFiles = useMemo(() => {
    if (categoryFilter === "all") return files
    return files.filter((f) => f.category === categoryFilter)
  }, [files, categoryFilter])

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <List className="h-5 w-5" />
              Pricing List
            </CardTitle>
            <CardDescription>
              All contracted pricing items from uploaded pricing files. Edit prices or add one-off items manually.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm">
              <Download className="mr-2 h-4 w-4" />
              Export All
            </Button>
            <Button size="sm">
              <Plus className="mr-2 h-4 w-4" />
              Add Item
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <DataTable
            columns={columns}
            data={filteredFiles}
            searchKey="productDescription"
            searchPlaceholder="Search items, SKUs..."
            isLoading={isLoading}
            filterComponent={
              <>
                <Select value={vendorFilter} onValueChange={setVendorFilter}>
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder="All Vendors" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Vendors</SelectItem>
                    {vendorData?.vendors.map((v) => (
                      <SelectItem key={v.id} value={v.id}>
                        {v.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder="All Categories" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Categories</SelectItem>
                    {categories.map((cat) => (
                      <SelectItem key={cat} value={cat}>
                        {cat}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </>
            }
          />
        </div>
      </CardContent>
    </Card>
  )
}
