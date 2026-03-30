"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import {
  getVendorAlerts,
  resolveVendorAlert,
  dismissVendorAlert,
  bulkResolveVendorAlerts,
  bulkDismissVendorAlerts,
} from "@/lib/actions/vendor-alerts"
import type { AlertType, AlertSeverity, AlertStatus } from "@prisma/client"
import { toast } from "sonner"

export function useVendorAlerts(
  vendorId: string,
  filters?: { alertType?: AlertType; severity?: AlertSeverity; status?: AlertStatus }
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
