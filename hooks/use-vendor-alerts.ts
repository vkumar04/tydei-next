"use client"

import { useQuery } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import { useAlertMutation } from "@/hooks/use-alert-mutation"
import {
  getVendorAlerts,
  resolveVendorAlert,
  dismissVendorAlert,
  bulkResolveVendorAlerts,
  bulkDismissVendorAlerts,
  bulkMarkVendorAlertsRead,
  markAllVendorAlertsRead,
} from "@/lib/actions/vendor-alerts"
import type { AlertType, AlertSeverity, AlertStatus } from "@/lib/generated/prisma/client"

const INVALIDATE = [queryKeys.alerts.all]

export function useVendorAlerts(
  vendorId: string,
  filters?: {
    alertType?: AlertType
    severity?: AlertSeverity
    status?: AlertStatus
    page?: number
    pageSize?: number
  }
) {
  return useQuery({
    queryKey: queryKeys.alerts.list("vendor", vendorId, filters),
    queryFn: () => getVendorAlerts({ vendorId, ...filters }),
  })
}

export function useResolveVendorAlert() {
  return useAlertMutation(resolveVendorAlert, {
    invalidate: INVALIDATE,
    success: () => "Alert resolved",
    error: "Failed to resolve alert",
  })
}

export function useDismissVendorAlert() {
  return useAlertMutation(dismissVendorAlert, {
    invalidate: INVALIDATE,
    success: () => "Alert dismissed",
    error: "Failed to dismiss alert",
  })
}

export function useBulkResolveVendorAlerts() {
  return useAlertMutation(bulkResolveVendorAlerts, {
    invalidate: INVALIDATE,
    success: (d) => `${d.resolved} alert(s) resolved`,
    error: "Failed to resolve alerts",
  })
}

export function useBulkDismissVendorAlerts() {
  return useAlertMutation(bulkDismissVendorAlerts, {
    invalidate: INVALIDATE,
    success: (d) => `${d.dismissed} alert(s) dismissed`,
    error: "Failed to dismiss alerts",
  })
}

export function useBulkMarkVendorAlertsRead() {
  return useAlertMutation(bulkMarkVendorAlertsRead, {
    invalidate: INVALIDATE,
    success: (d) =>
      d.updated > 0 ? `${d.updated} alert(s) marked read` : "No unread alerts",
    error: "Failed to mark read",
  })
}

export function useMarkAllVendorAlertsRead() {
  return useAlertMutation<void, { updated: number }>(() => markAllVendorAlertsRead(), {
    invalidate: INVALIDATE,
    success: (d) =>
      d.updated > 0 ? `${d.updated} alert(s) marked read` : "No unread alerts",
    error: "Failed to mark all read",
  })
}
