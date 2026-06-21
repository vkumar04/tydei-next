"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { queryKeys } from "@/lib/query-keys"
import {
  getVendorCogRecords,
  getVendorCogStats,
  recomputeVendorCogMatches,
  type VendorCogFilters,
} from "@/lib/actions/vendor-cog"
import {
  bulkImportVendorCogRecords,
  type BulkImportVendorCogOptions,
} from "@/lib/actions/imports/vendor-cog-import"

/**
 * Vendor-owned COG (1-way mode) data hooks. Keys go through the
 * `queryKeys.vendorCog.*` factory (never inline literals) so the import
 * mutation's `queryKeys.vendorCog.base` invalidation refreshes BOTH the
 * list and the stats (prefix invalidation).
 */

export function useVendorCogRecords(
  vendorId: string,
  filters: VendorCogFilters = {},
) {
  return useQuery({
    queryKey: queryKeys.vendorCog.list(vendorId, filters as Record<string, unknown>),
    queryFn: () => getVendorCogRecords(filters),
  })
}

export function useVendorCogStats(vendorId: string) {
  return useQuery({
    queryKey: queryKeys.vendorCog.stats(vendorId),
    queryFn: () => getVendorCogStats(),
  })
}

export function useImportVendorCog(vendorId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      rows: Record<string, string>[]
      opts?: BulkImportVendorCogOptions
    }) => bulkImportVendorCogRecords(input.rows, input.opts),
    onSuccess: (result) => {
      // Prefix invalidation: vendorCog.base covers both list + stats keys.
      qc.invalidateQueries({ queryKey: queryKeys.vendorCog.base })
      const { imported, skipped } = result
      toast.success(
        `Imported ${imported.toLocaleString()} COG row${imported === 1 ? "" : "s"}` +
          (skipped > 0 ? ` (${skipped.toLocaleString()} skipped)` : ""),
      )
    },
    onError: (err) =>
      toast.error(err.message || "Failed to import COG records"),
    // vendorId is carried in meta only so the mutation is identifiable per
    // vendor in devtools; the action resolves the owning vendor server-side.
    meta: { vendorId },
  })
}

// Re-match the vendor's COG against its own contracts (populates "On
// Contract" for COG imported before the matcher existed).
export function useRecomputeVendorCog(vendorId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => recomputeVendorCogMatches(),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: queryKeys.vendorCog.base })
      toast.success(
        `Matched ${result.onContract.toLocaleString()} of ${result.total.toLocaleString()} COG rows to a contract`,
      )
    },
    onError: (err) =>
      toast.error(err.message || "Failed to recompute COG matches"),
    meta: { vendorId },
  })
}
