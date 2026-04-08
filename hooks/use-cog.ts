"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import {
  getCOGRecords,
  createCOGRecord,
  bulkImportCOGRecords,
  deleteCOGRecord,
  bulkDeleteCOGRecords,
  getCOGImportHistory,
  getCOGStats,
  deleteCOGFileByDate,
  updateCOGRecord,
} from "@/lib/actions/cog-records"
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
      toast.success(
        `Imported ${result.imported} records (${result.skipped} skipped, ${result.errors} errors)`
      )
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
      toast.success(`Deleted ${result.deleted} records`)
    },
    onError: (err) => toast.error(err.message || "Failed to delete records"),
  })
}

export function useDeleteCOGFile() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: deleteCOGFileByDate,
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: queryKeys.cogRecords.all })
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
      toast.success("Record updated")
    },
    onError: (err) => toast.error(err.message || "Failed to update record"),
  })
}
