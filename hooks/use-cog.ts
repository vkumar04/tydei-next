"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import { useToastMutation } from "@/hooks/use-toast-mutation"
import { toast } from "sonner"
import {
  getCOGRecords,
  createCOGRecord,
  deleteCOGRecord,
  bulkDeleteCOGRecords,
  clearAllCOGRecords,
  getCOGImportHistory,
  getCOGStats,
  deleteCOGFileByDate,
  updateCOGRecord,
} from "@/lib/actions/cog-records"
import { bulkImportCOGRecords } from "@/lib/actions/cog-import"
import { backfillCOGEnrichment } from "@/lib/actions/cog-import/backfill"
import type { COGFilters } from "@/lib/validators/cog-records"

// Every COG mutation refreshes the COG list/stats (`cogRecords.all`) AND the
// per-category market-share card (`categoryMarketShareBase`) — COG mutations
// change the per-category share denominator, and the contract-detail
// Performance tab + vendor dashboard widget have no refetchInterval, so they'd
// stay stale otherwise (Charles 2026-04-28 #H follow-up).
const COG_INVALIDATE = [
  queryKeys.cogRecords.all,
  queryKeys.contracts.categoryMarketShareBase,
]

export function useCOGRecords(
  facilityId: string,
  filters?: Partial<COGFilters>
) {
  return useQuery({
    queryKey: queryKeys.cogRecords.list(facilityId, filters),
    queryFn: () => getCOGRecords({ ...filters, facilityId }),
  })
}

export function useCOGImportHistory(facilityId: string) {
  return useQuery({
    queryKey: queryKeys.cogRecords.importHistory(facilityId),
    queryFn: () => getCOGImportHistory(facilityId),
  })
}

export function useCOGStats(facilityId: string) {
  return useQuery({
    queryKey: queryKeys.cogRecords.stats(facilityId),
    queryFn: () => getCOGStats(facilityId),
  })
}

export function useCreateCOGRecord() {
  return useToastMutation(createCOGRecord, {
    invalidate: COG_INVALIDATE,
    success: "COG record created",
    error: "Failed to create record",
  })
}

export function useImportCOGRecords() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: bulkImportCOGRecords,
    onSuccess: (result) => {
      // Kept a bespoke useMutation (not useToastMutation): the conditional
      // recompute-failure `toast.warning` below is extra logic the factory
      // doesn't model. Shares COG_INVALIDATE so the keys can't drift.
      for (const key of COG_INVALIDATE) qc.invalidateQueries({ queryKey: key })
      toast.success(
        `Imported ${result.imported} records (${result.skipped} skipped, ${result.errors} errors)`
      )
      // 2026-04-28 strategic-direction Plan #3 light: surface
      // recompute step failures so users learn the import succeeded
      // but downstream contract numbers may be stale until they
      // click Refresh / Recompute on the affected contract.
      const failures = result.recomputeFailures ?? []
      if (failures.length > 0) {
        toast.warning(
          `Import succeeded but ${failures.length} recompute step${failures.length === 1 ? "" : "s"} failed. Contract-detail numbers may be stale — open each affected contract and click Recompute Earned Rebates. Failures: ${failures.slice(0, 3).map((f) => f.step).join("; ")}${failures.length > 3 ? `; …+${failures.length - 3} more` : ""}`,
          { duration: 12_000 },
        )
      }
    },
    onError: (err) => toast.error(err.message || "Import failed"),
  })
}

export function useDeleteCOGRecord() {
  return useToastMutation(deleteCOGRecord, {
    invalidate: COG_INVALIDATE,
    success: "Record deleted",
    error: "Failed to delete record",
  })
}

export function useBulkDeleteCOGRecords() {
  return useToastMutation(bulkDeleteCOGRecords, {
    invalidate: COG_INVALIDATE,
    success: (result) => `Deleted ${result.deleted} records`,
    error: "Failed to delete records",
  })
}

export function useClearAllCOGRecords() {
  return useToastMutation(clearAllCOGRecords, {
    invalidate: COG_INVALIDATE,
    success: (result) =>
      `Cleared all ${result.deleted.toLocaleString()} COG records`,
    error: "Failed to clear records",
  })
}

export function useDeleteCOGFile() {
  return useToastMutation(deleteCOGFileByDate, {
    invalidate: COG_INVALIDATE,
    success: (result) => `Deleted ${result.deleted} records`,
    error: "Failed to delete file",
  })
}

export function useUpdateCOGRecord() {
  return useToastMutation(
    ({ id, data }: { id: string; data: Parameters<typeof updateCOGRecord>[1] }) =>
      updateCOGRecord(id, data),
    {
      invalidate: COG_INVALIDATE,
      success: "Record updated",
      error: "Failed to update record",
    },
  )
}

export function useBackfillCOGEnrichment() {
  return useToastMutation(backfillCOGEnrichment, {
    invalidate: COG_INVALIDATE,
    success: (r) =>
      `Enriched ${r.enriched} records (${r.pendingAfter} still pending)`,
    error: "Backfill failed",
  })
}
