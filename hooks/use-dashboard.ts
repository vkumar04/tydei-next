"use client"

import { useQuery } from "@tanstack/react-query"
import { queryKeys, type DateRange } from "@/lib/query-keys"
import {
  getDashboardStats,
  getEarnedRebateByMonth,
  getSpendByVendor,
  getContractLifecycle,
  getSpendNeededForTier,
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

export function useEarnedRebateByMonth(facilityId: string, dateRange: DateRange) {
  return useQuery({
    queryKey: queryKeys.dashboard.earnedRebate(facilityId, dateRange),
    queryFn: () =>
      getEarnedRebateByMonth({ facilityId, dateFrom: dateRange.from, dateTo: dateRange.to }),
  })
}

export function useSpendByVendor(facilityId: string, dateRange: DateRange) {
  return useQuery({
    queryKey: queryKeys.dashboard.spendByVendor(facilityId, dateRange),
    queryFn: () =>
      getSpendByVendor({ facilityId, dateFrom: dateRange.from, dateTo: dateRange.to }),
  })
}

export function useContractLifecycle(facilityId: string) {
  return useQuery({
    queryKey: queryKeys.dashboard.contractLifecycle(facilityId),
    queryFn: () => getContractLifecycle(facilityId),
  })
}

export function useSpendNeededForTier(facilityId: string) {
  return useQuery({
    queryKey: queryKeys.dashboard.spendNeededForTier(facilityId),
    queryFn: () => getSpendNeededForTier(facilityId),
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
