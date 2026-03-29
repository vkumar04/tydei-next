"use client"

import { useQuery } from "@tanstack/react-query"
import { queryKeys, type DateRange } from "@/lib/query-keys"
import {
  getDashboardStats,
  getMonthlySpend,
  getSpendByVendor,
  getSpendByCategory,
  getRecentContracts,
  getRecentAlerts,
} from "@/lib/actions/dashboard"

export function useDashboardStats(facilityId: string, dateRange: DateRange) {
  return useQuery({
    queryKey: queryKeys.dashboard.stats(facilityId, dateRange),
    queryFn: () =>
      getDashboardStats({ facilityId, dateFrom: dateRange.from, dateTo: dateRange.to }),
  })
}

export function useMonthlySpend(facilityId: string, dateRange: DateRange) {
  return useQuery({
    queryKey: queryKeys.dashboard.monthlySpend(facilityId, dateRange),
    queryFn: () =>
      getMonthlySpend({ facilityId, dateFrom: dateRange.from, dateTo: dateRange.to }),
  })
}

export function useSpendByVendor(facilityId: string, dateRange: DateRange) {
  return useQuery({
    queryKey: queryKeys.dashboard.spendByVendor(facilityId, dateRange),
    queryFn: () =>
      getSpendByVendor({ facilityId, dateFrom: dateRange.from, dateTo: dateRange.to }),
  })
}

export function useSpendByCategory(facilityId: string, dateRange: DateRange) {
  return useQuery({
    queryKey: queryKeys.dashboard.spendByCategory(facilityId, dateRange),
    queryFn: () =>
      getSpendByCategory({ facilityId, dateFrom: dateRange.from, dateTo: dateRange.to }),
  })
}

export function useRecentContracts(facilityId: string) {
  return useQuery({
    queryKey: queryKeys.dashboard.recentContracts(facilityId),
    queryFn: () => getRecentContracts(facilityId),
  })
}

export function useRecentAlerts(facilityId: string) {
  return useQuery({
    queryKey: queryKeys.dashboard.recentAlerts(facilityId),
    queryFn: () => getRecentAlerts(facilityId),
  })
}
