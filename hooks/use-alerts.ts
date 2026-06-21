"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import { useAlertMutation } from "@/hooks/use-alert-mutation"
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
import { toast } from "sonner"

// An alert mutation refreshes the Alerts page + header badge (`alerts.*`) AND
// the dashboard "Open Alerts" KPI (`dashboard.*`) — the dashboard KPI has no
// refetchInterval, so it would otherwise stay stale after resolve/dismiss.
const INVALIDATE = [queryKeys.alerts.all, queryKeys.dashboard.all]

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
  return useAlertMutation(resolveAlert, {
    invalidate: INVALIDATE,
    success: () => "Alert resolved",
    error: "Failed to resolve alert",
  })
}

export function useDismissAlert() {
  return useAlertMutation(dismissAlert, {
    invalidate: INVALIDATE,
    success: () => "Alert dismissed",
    error: "Failed to dismiss alert",
  })
}

// Silent on purpose: auto-fired when a user opens an alert detail — no toast.
export function useMarkAlertRead() {
  return useAlertMutation(markAlertRead, { invalidate: INVALIDATE })
}

export function useBulkResolveAlerts() {
  return useAlertMutation(bulkResolveAlerts, {
    invalidate: INVALIDATE,
    success: (d) => `${d.resolved} alert(s) resolved`,
    error: "Failed to resolve alerts",
  })
}

export function useBulkDismissAlerts() {
  return useAlertMutation(bulkDismissAlerts, {
    invalidate: INVALIDATE,
    success: (d) => `${d.dismissed} alert(s) dismissed`,
    error: "Failed to dismiss alerts",
  })
}

// Kept custom: the success message depends on the `action` variable.
export function useBulkUpdateAlerts() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { alertIds: string[]; action: BulkAlertAction }) =>
      bulkUpdateAlerts(input),
    onSuccess: (data, variables) => {
      for (const key of INVALIDATE) qc.invalidateQueries({ queryKey: key })
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
  return useAlertMutation<void, { updated: number }>(() => markAllAlertsRead(), {
    invalidate: INVALIDATE,
    success: (d) =>
      d.updated > 0 ? `${d.updated} alert(s) marked read` : "No unread alerts",
    error: "Failed to mark all read",
  })
}
