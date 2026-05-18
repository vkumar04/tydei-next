"use client"

import { useState, useMemo } from "react"
import { Download, Plus, List } from "lucide-react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { getVendors } from "@/lib/actions/vendors"
import { toast } from "sonner"
import {
  useDeletePricingFile,
  usePricingFiles,
} from "@/hooks/use-pricing-files"
import { queryKeys } from "@/lib/query-keys"
import { deleteContractPricing } from "@/lib/actions/pricing-files"
import type { UnifiedPricingRow } from "@/lib/actions/pricing-files"
import { getPricingColumns } from "@/components/facility/cog/pricing-columns"
import { DataTable } from "@/components/shared/tables/data-table"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { VendorFilterCombobox } from "@/components/shared/vendor-filter-combobox"

interface PricingFilesTableProps {
  facilityId: string
}

export function PricingFilesTable({ facilityId }: PricingFilesTableProps) {
  const [vendorFilter, setVendorFilter] = useState<string>("all")
  const [categoryFilter, setCategoryFilter] = useState<string>("all")
  const [pendingDelete, setPendingDelete] = useState<UnifiedPricingRow | null>(
    null,
  )

  const { data, isLoading } = usePricingFiles(
    facilityId,
    vendorFilter && vendorFilter !== "all" ? vendorFilter : undefined,
  )
  // Bug 2026-05-18 (Vick "only see the A's"): use the full vendor list
  // for the filter dropdown, not the paginated 20-per-page table shape.
  const { data: vendorData } = useQuery({
    queryKey: queryKeys.vendors.all,
    queryFn: () => getVendors(),
  })
  const deleteFileMutation = useDeletePricingFile()
  const qc = useQueryClient()
  const deleteContractPricingMutation = useMutation({
    mutationFn: (id: string) => deleteContractPricing(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.pricingFiles.all })
      toast.success("Contract pricing row deleted")
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Failed to delete"),
  })
  const pendingDeleteId = deleteFileMutation.isPending
    ? deleteFileMutation.variables
    : deleteContractPricingMutation.isPending
      ? deleteContractPricingMutation.variables
      : null
  const columns = useMemo(
    () =>
      getPricingColumns({
        onDelete: (row) => setPendingDelete(row),
        pendingDeleteId,
      }),
    [pendingDeleteId],
  )

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
                <VendorFilterCombobox
                  vendors={vendorData ?? []}
                  value={vendorFilter === "all" ? "" : vendorFilter}
                  onChange={(next) => setVendorFilter(next || "all")}
                  placeholder="All Vendors"
                  width={180}
                />
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

      <AlertDialog
        open={!!pendingDelete}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete pricing row?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete?.source === "contract"
                ? `This permanently removes the pricing row from contract "${pendingDelete?.contractName ?? ""}". This cannot be undone.`
                : "This permanently removes the pricing row from this facility. Any contract-pricing entries that reference the same vendor item number will also be cleared. This cannot be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (!pendingDelete) return
                if (pendingDelete.source === "contract") {
                  deleteContractPricingMutation.mutate(pendingDelete.id)
                } else {
                  deleteFileMutation.mutate(pendingDelete.id)
                }
                setPendingDelete(null)
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}
