"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import {
  getAlerts,
  getAlert,
  getUnreadAlertCount,
  markAlertRead,
  resolveAlert,
  dismissAlert,
  bulkResolveAlerts,
  bulkDismissAlerts,
  bulkUpdateAlerts,
  markAllAlertsRead,
} from "@/lib/actions/alerts"
import type { AlertFilters } from "@/lib/validators/alerts"
import type { BulkAlertAction } from "@/lib/alerts/bulk-actions"
import { toast } from "sonner"

export function useAlerts(facilityId: string, filters: Partial<AlertFilters> = {}) {
  return useQuery({
    queryKey: queryKeys.alerts.list("facility", facilityId, filters),
    queryFn: () => getAlerts({ portalType: "facility", ...filters }),
  })
}

export function useAlert(id: string) {
  return useQuery({
    queryKey: queryKeys.alerts.detail(id),
    queryFn: () => getAlert(id),
    enabled: !!id,
  })
}

export function useUnreadAlertCount(facilityId: string) {
  return useQuery({
    queryKey: queryKeys.alerts.unreadCount("facility", facilityId),
    queryFn: () => getUnreadAlertCount({ facilityId, portalType: "facility" }),
    refetchInterval: 30_000,
  })
}

export function useResolveAlert() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: resolveAlert,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.alerts.all })
      toast.success("Alert resolved")
    },
    onError: (e) => toast.error(e.message || "Failed to resolve alert"),
  })
}

export function useDismissAlert() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: dismissAlert,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.alerts.all })
      toast.success("Alert dismissed")
    },
    onError: (e) => toast.error(e.message || "Failed to dismiss alert"),
  })
}

export function useMarkAlertRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: markAlertRead,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.alerts.all })
    },
  })
}

export function useBulkResolveAlerts() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: bulkResolveAlerts,
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: queryKeys.alerts.all })
      toast.success(`${data.resolved} alert(s) resolved`)
    },
    onError: (e) => toast.error(e.message || "Failed to resolve alerts"),
  })
}

export function useBulkDismissAlerts() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: bulkDismissAlerts,
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: queryKeys.alerts.all })
      toast.success(`${data.dismissed} alert(s) dismissed`)
    },
    onError: (e) => toast.error(e.message || "Failed to dismiss alerts"),
  })
}

export function useBulkUpdateAlerts() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { alertIds: string[]; action: BulkAlertAction }) =>
      bulkUpdateAlerts(input),
    onSuccess: (data, variables) => {
      qc.invalidateQueries({ queryKey: queryKeys.alerts.all })
      const verb =
        variables.action === "mark_read"
          ? "marked read"
          : variables.action === "resolve"
            ? "resolved"
            : "dismissed"
      const skippedNote = data.skipped > 0 ? ` (${data.skipped} skipped)` : ""
      toast.success(`${data.updated} alert(s) ${verb}${skippedNote}`)
    },
    onError: (e) => toast.error(e.message || "Failed to update alerts"),
  })
}

export function useMarkAllAlertsRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => markAllAlertsRead(),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: queryKeys.alerts.all })
      toast.success(
        data.updated > 0
          ? `${data.updated} alert(s) marked read`
          : "No unread alerts",
      )
    },
    onError: (e) => toast.error(e.message || "Failed to mark all read"),
  })
}
