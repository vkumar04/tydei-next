"use client"

import { useMutation, useQuery } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import { generateFacilityAnalysisInsights } from "@/lib/actions/ai/facility-analysis-insights"
import type { AnalysisDataScope } from "@/lib/actions/facility-analysis-data"
import { generateVendorOpportunityInsights } from "@/lib/actions/ai/vendor-opportunity-insights"
import { getVendorOpportunityData } from "@/lib/actions/vendor-opportunity-data"
import type {
  FacilityAnalysisInsights,
  FacilityInsightSnapshot,
  VendorInsightSnapshot,
  VendorOpportunityInsights,
} from "@/lib/ai/analysis-insight-schemas"

/**
 * On-demand AI insight mutations — fired by a "Generate AI insights" button so
 * the deterministic sliders stay snappy (AI never runs on every drag).
 * `retry: false`: AI errors aren't transient/user-fixable.
 */
export function useFacilityAnalysisInsights() {
  return useMutation<
    FacilityAnalysisInsights,
    Error,
    { snapshot: FacilityInsightSnapshot; scope?: AnalysisDataScope }
  >({
    mutationFn: ({ snapshot, scope }) =>
      generateFacilityAnalysisInsights(snapshot, scope),
    retry: false,
  })
}

export function useVendorOpportunityInsights() {
  return useMutation<VendorOpportunityInsights, Error, VendorInsightSnapshot>({
    mutationFn: (snapshot) => generateVendorOpportunityInsights(snapshot),
    retry: false,
  })
}

/**
 * Vendor Opportunity Engine DB seed (addressable spend, current share, ASP).
 * `facilityId` (optional) scopes the seed to ONE facility — the Deal Scenario
 * facility — instead of the vendor's whole book of business. The key gains
 * the param (prefix-compatible with the `vendorOpportunityDataBase` family,
 * so existing prefix invalidations refresh scoped variants too).
 */
export function useVendorOpportunityData(vendorId: string, facilityId?: string) {
  return useQuery({
    queryKey: queryKeys.prospectiveAnalysis.vendorOpportunityData(
      vendorId,
      facilityId,
    ),
    queryFn: () => getVendorOpportunityData(facilityId),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  })
}
