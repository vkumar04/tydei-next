"use client"

import { useQuery } from "@tanstack/react-query"
import { queryKeys, type DateRange } from "@/lib/query-keys"
import {
  getVendorDashboardStats,
  getVendorSpendTrend,
  getVendorMarketShareByCategory,
  getVendorContractStatusBreakdown,
  getVendorRecentContracts,
} from "@/lib/actions/vendor-dashboard"

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

export function useVendorMarketShareByCategory(vendorId: string) {
  return useQuery({
    queryKey: queryKeys.vendorDashboard.marketShareByCategory(vendorId),
    queryFn: () => getVendorMarketShareByCategory(vendorId),
  })
}

export function useVendorContractStatus(vendorId: string) {
  return useQuery({
    queryKey: queryKeys.vendorDashboard.contractStatus(vendorId),
    queryFn: () => getVendorContractStatusBreakdown(vendorId),
  })
}

export function useVendorRecentContracts(vendorId: string) {
  return useQuery({
    queryKey: queryKeys.vendorDashboard.recentContracts(vendorId),
    queryFn: () => getVendorRecentContracts(vendorId),
  })
}
