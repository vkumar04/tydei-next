"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
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
import { toast } from "sonner"

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
  const qc = useQueryClient()
  return useMutation({
    mutationFn: resolveVendorAlert,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.alerts.all })
      toast.success("Alert resolved")
    },
    onError: (e) => toast.error(e.message || "Failed to resolve alert"),
  })
}

export function useDismissVendorAlert() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: dismissVendorAlert,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.alerts.all })
      toast.success("Alert dismissed")
    },
    onError: (e) => toast.error(e.message || "Failed to dismiss alert"),
  })
}

export function useBulkResolveVendorAlerts() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: bulkResolveVendorAlerts,
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: queryKeys.alerts.all })
      toast.success(`${data.resolved} alert(s) resolved`)
    },
    onError: (e) => toast.error(e.message || "Failed to resolve alerts"),
  })
}

export function useBulkDismissVendorAlerts() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: bulkDismissVendorAlerts,
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: queryKeys.alerts.all })
      toast.success(`${data.dismissed} alert(s) dismissed`)
    },
    onError: (e) => toast.error(e.message || "Failed to dismiss alerts"),
  })
}

export function useBulkMarkVendorAlertsRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: bulkMarkVendorAlertsRead,
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: queryKeys.alerts.all })
      toast.success(
        data.updated > 0 ? `${data.updated} alert(s) marked read` : "No unread alerts",
      )
    },
    onError: (e) => toast.error(e.message || "Failed to mark read"),
  })
}

export function useMarkAllVendorAlertsRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => markAllVendorAlertsRead(),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: queryKeys.alerts.all })
      toast.success(
        data.updated > 0 ? `${data.updated} alert(s) marked read` : "No unread alerts",
      )
    },
    onError: (e) => toast.error(e.message || "Failed to mark all read"),
  })
}
