"use client"

import { useMutation, useQuery } from "@tanstack/react-query"
import { queryKeys, type DateRange } from "@/lib/query-keys"
import {
  calculateDepreciation,
  getPriceProjections,
  getVendorSpendTrends,
  getCategorySpendTrends,
} from "@/lib/actions/analysis"
import {
  getSpendForecast,
  getRebateForecast,
} from "@/lib/actions/forecasting"
import { toast } from "sonner"

export function useDepreciation() {
  return useMutation({
    mutationFn: calculateDepreciation,
    onError: (err) => toast.error(err.message || "Depreciation calculation failed"),
  })
}

export function usePriceProjections(
  facilityId: string,
  filters?: { vendorId?: string; categoryId?: string; periods?: number }
) {
  return useQuery({
    queryKey: queryKeys.analysis.priceProjections(facilityId, filters),
    queryFn: () =>
      getPriceProjections({
        facilityId,
        vendorId: filters?.vendorId,
        categoryId: filters?.categoryId,
        periods: filters?.periods ?? 12,
      }),
  })
}

export function useVendorSpendTrends(
  facilityId: string,
  dateRange?: DateRange
) {
  return useQuery({
    queryKey: queryKeys.analysis.vendorSpendTrends(facilityId, dateRange),
    queryFn: () =>
      getVendorSpendTrends({
        facilityId,
        dateFrom: dateRange?.from ?? "",
        dateTo: dateRange?.to ?? "",
      }),
    enabled: !!dateRange?.from && !!dateRange?.to,
  })
}

export function useCategorySpendTrends(
  facilityId: string,
  dateRange?: DateRange
) {
  return useQuery({
    queryKey: queryKeys.analysis.categorySpendTrends(facilityId, dateRange),
    queryFn: () =>
      getCategorySpendTrends({
        facilityId,
        dateFrom: dateRange?.from ?? "",
        dateTo: dateRange?.to ?? "",
      }),
    enabled: !!dateRange?.from && !!dateRange?.to,
  })
}

export function useSpendForecast(
  facilityId: string,
  options?: { contractId?: string; periods?: number }
) {
  return useQuery({
    queryKey: queryKeys.forecasting.spend(facilityId, options),
    queryFn: () =>
      getSpendForecast({
        facilityId,
        contractId: options?.contractId,
        periods: options?.periods ?? 6,
      }),
  })
}

export function useRebateForecast(
  facilityId: string,
  options?: { contractId?: string; periods?: number }
) {
  return useQuery({
    queryKey: queryKeys.forecasting.rebate(facilityId, options),
    queryFn: () =>
      getRebateForecast({
        facilityId,
        contractId: options?.contractId,
        periods: options?.periods ?? 6,
      }),
  })
}
