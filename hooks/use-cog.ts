"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
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
import { toast } from "sonner"

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
  const qc = useQueryClient()
  return useMutation({
    mutationFn: createCOGRecord,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.cogRecords.all })
      // Charles 2026-04-28 #H follow-up: COG mutations change the
      // per-category share denominator. Invalidate the market-share
      // card explicitly so the contract-detail Performance tab and
      // vendor dashboard widget refetch.
      qc.invalidateQueries({ queryKey: ["category-market-share"] })
      toast.success("COG record created")
    },
    onError: (err) => toast.error(err.message || "Failed to create record"),
  })
}

export function useImportCOGRecords() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: bulkImportCOGRecords,
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: queryKeys.cogRecords.all })
      // Charles 2026-04-28 #H follow-up: COG mutations change the
      // per-category share denominator. Invalidate the market-share
      // card explicitly so the contract-detail Performance tab and
      // vendor dashboard widget refetch.
      qc.invalidateQueries({ queryKey: ["category-market-share"] })
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
  const qc = useQueryClient()
  return useMutation({
    mutationFn: deleteCOGRecord,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.cogRecords.all })
      // Charles 2026-04-28 #H follow-up: COG mutations change the
      // per-category share denominator. Invalidate the market-share
      // card explicitly so the contract-detail Performance tab and
      // vendor dashboard widget refetch.
      qc.invalidateQueries({ queryKey: ["category-market-share"] })
      toast.success("Record deleted")
    },
    onError: (err) => toast.error(err.message || "Failed to delete record"),
  })
}

export function useBulkDeleteCOGRecords() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: bulkDeleteCOGRecords,
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: queryKeys.cogRecords.all })
      // Charles 2026-04-28 #H follow-up: COG mutations change the
      // per-category share denominator. Invalidate the market-share
      // card explicitly so the contract-detail Performance tab and
      // vendor dashboard widget refetch.
      qc.invalidateQueries({ queryKey: ["category-market-share"] })
      toast.success(`Deleted ${result.deleted} records`)
    },
    onError: (err) => toast.error(err.message || "Failed to delete records"),
  })
}

export function useClearAllCOGRecords() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: clearAllCOGRecords,
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: queryKeys.cogRecords.all })
      // Charles 2026-04-28 #H follow-up: COG mutations change the
      // per-category share denominator. Invalidate the market-share
      // card explicitly so the contract-detail Performance tab and
      // vendor dashboard widget refetch.
      qc.invalidateQueries({ queryKey: ["category-market-share"] })
      toast.success(`Cleared all ${result.deleted.toLocaleString()} COG records`)
    },
    onError: (err) => toast.error(err.message || "Failed to clear records"),
  })
}

export function useDeleteCOGFile() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: deleteCOGFileByDate,
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: queryKeys.cogRecords.all })
      // Charles 2026-04-28 #H follow-up: COG mutations change the
      // per-category share denominator. Invalidate the market-share
      // card explicitly so the contract-detail Performance tab and
      // vendor dashboard widget refetch.
      qc.invalidateQueries({ queryKey: ["category-market-share"] })
      toast.success(`Deleted ${result.deleted} records`)
    },
    onError: (err) => toast.error(err.message || "Failed to delete file"),
  })
}

export function useUpdateCOGRecord() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof updateCOGRecord>[1] }) =>
      updateCOGRecord(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.cogRecords.all })
      // Charles 2026-04-28 #H follow-up: COG mutations change the
      // per-category share denominator. Invalidate the market-share
      // card explicitly so the contract-detail Performance tab and
      // vendor dashboard widget refetch.
      qc.invalidateQueries({ queryKey: ["category-market-share"] })
      toast.success("Record updated")
    },
    onError: (err) => toast.error(err.message || "Failed to update record"),
  })
}

export function useBackfillCOGEnrichment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: backfillCOGEnrichment,
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: queryKeys.cogRecords.all })
      // Charles 2026-04-28 #H follow-up: COG mutations change the
      // per-category share denominator. Invalidate the market-share
      // card explicitly so the contract-detail Performance tab and
      // vendor dashboard widget refetch.
      qc.invalidateQueries({ queryKey: ["category-market-share"] })
      qc.invalidateQueries({ queryKey: ["cog"] })
      toast.success(
        `Enriched ${r.enriched} records (${r.pendingAfter} still pending)`,
      )
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Backfill failed"),
  })
}
