"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import {
  getPricingFiles,
  bulkImportPricingFiles,
  deletePricingFilesByVendor,
} from "@/lib/actions/pricing-files"
import type { PricingFilters } from "@/lib/validators/pricing-files"
import { toast } from "sonner"

export function usePricingFiles(
  facilityId: string,
  vendorId?: string
) {
  return useQuery({
    queryKey: queryKeys.pricingFiles.list(facilityId, vendorId),
    queryFn: () =>
      getPricingFiles({
        facilityId,
        ...(vendorId && { vendorId }),
      }),
  })
}

export function useImportPricingFiles() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: bulkImportPricingFiles,
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: queryKeys.pricingFiles.all })
      toast.success(
        `Imported ${result.imported} pricing entries (${result.errors} errors)`
      )
    },
    onError: (err) => toast.error(err.message || "Import failed"),
  })
}

export function useDeletePricingFilesByVendor() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ vendorId, facilityId }: { vendorId: string; facilityId: string }) =>
      deletePricingFilesByVendor(vendorId, facilityId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.pricingFiles.all })
      toast.success("Pricing files deleted")
    },
    onError: (err) => toast.error(err.message || "Failed to delete"),
  })
}
