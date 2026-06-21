"use client"

import { useQuery } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import { useToastMutation } from "@/hooks/use-toast-mutation"
import {
  getPricingFiles,
  bulkImportPricingFiles,
  deletePricingFile,
  deletePricingFilesByVendor,
  getUploadedPricingFiles,
} from "@/lib/actions/pricing-files"

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
        // 2026-04-28: Charles "All price files still not here and no
        // pagination". The action defaults to pageSize 20 and the
        // client passes no page state, so only the first 20 ever
        // load. Bump to 5000 so the shared DataTable's pagination
        // (20/page client-side) shows the full set. Real server-side
        // pagination is the follow-up if files grow past ~5000.
        pageSize: 5000,
      }),
  })
}

export function useImportPricingFiles() {
  return useToastMutation(bulkImportPricingFiles, {
    invalidate: [queryKeys.pricingFiles.all],
    success: (result) =>
      `Imported ${result.imported} pricing entries (${result.errors} errors)`,
    error: "Import failed",
  })
}

export function useDeletePricingFilesByVendor() {
  return useToastMutation(
    ({ vendorId, facilityId }: { vendorId: string; facilityId: string }) =>
      deletePricingFilesByVendor(vendorId, facilityId),
    {
      invalidate: [queryKeys.pricingFiles.all, queryKeys.cogRecords.all],
      success: (result) =>
        `Deleted ${result.deleted.toLocaleString()} pricing rows`,
      error: "Failed to delete",
    },
  )
}

export function useDeletePricingFile() {
  return useToastMutation((id: string) => deletePricingFile(id), {
    invalidate: [queryKeys.pricingFiles.all],
    success: "Pricing row deleted",
    error: "Failed to delete",
  })
}

export function useUploadedPricingFiles() {
  return useQuery({
    queryKey: [...queryKeys.pricingFiles.all, "uploaded"] as const,
    queryFn: () => getUploadedPricingFiles(),
  })
}
