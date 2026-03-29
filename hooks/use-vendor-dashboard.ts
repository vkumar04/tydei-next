"use client"

import { useQuery } from "@tanstack/react-query"
import { queryKeys, type DateRange } from "@/lib/query-keys"
import { getVendorDashboardStats, getVendorSpendTrend } from "@/lib/actions/vendor-dashboard"

export function useVendorDashboardStats(vendorId: string) {
  return useQuery({
    queryKey: queryKeys.vendorDashboard.stats(vendorId),
    queryFn: () => getVendorDashboardStats(vendorId),
  })
}

export function useVendorSpendTrend(vendorId: string, dateRange: DateRange) {
  return useQuery({
    queryKey: queryKeys.vendorDashboard.spendTrend(vendorId, dateRange),
    queryFn: () =>
      getVendorSpendTrend({
        vendorId,
        dateFrom: dateRange.from,
        dateTo: dateRange.to,
      }),
  })
}
