"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import {
  getAlerts,
  getAlert,
  getOpenAlertCount,
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
import type { QueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

/**
 * Invalidate every surface an alert mutation affects: the Alerts page +
 * header badge (`alerts.*`) AND the dashboard "Open Alerts" KPI
 * (`dashboard.*`). The dashboard KPI has no refetchInterval, so without this
 * it stayed stale after resolve/dismiss until a full reload (2026-06-21).
 */
function invalidateAlertSurfaces(qc: QueryClient): void {
  qc.invalidateQueries({ queryKey: queryKeys.alerts.all })
  qc.invalidateQueries({ queryKey: queryKeys.dashboard.all })
}

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
    queryFn: () => getOpenAlertCount({ facilityId, portalType: "facility" }),
    refetchInterval: 30_000,
  })
}

export function useResolveAlert() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: resolveAlert,
    onSuccess: () => {
      invalidateAlertSurfaces(qc)
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
      invalidateAlertSurfaces(qc)
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
      invalidateAlertSurfaces(qc)
    },
  })
}

export function useBulkResolveAlerts() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: bulkResolveAlerts,
    onSuccess: (data) => {
      invalidateAlertSurfaces(qc)
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
      invalidateAlertSurfaces(qc)
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
      invalidateAlertSurfaces(qc)
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
      invalidateAlertSurfaces(qc)
      toast.success(
        data.updated > 0
          ? `${data.updated} alert(s) marked read`
          : "No unread alerts",
      )
    },
    onError: (e) => toast.error(e.message || "Failed to mark all read"),
  })
}
