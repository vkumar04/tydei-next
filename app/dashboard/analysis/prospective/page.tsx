import { requireFacility } from "@/lib/actions/auth"
import { getFacilityAnalysisData } from "@/lib/actions/facility-analysis-data"
import { getVendors } from "@/lib/actions/vendors"
import { AnalysisPageClient } from "@/components/facility/analysis/analysis-page-client"

/**
 * Facility Analysis page — server shell.
 *
 * Two tabs (see AnalysisPageClient): the CFO "Current State" dashboard (modeled
 * from live spend/cases via getFacilityAnalysisData) and "Evaluate Proposals"
 * (upload/score contracts + pricing files — the prospective hub). 2026-06-21.
 */
export default async function AnalysisPage() {
  const { facility } = await requireFacility()
  const [data, vendors] = await Promise.all([
    getFacilityAnalysisData(),
    getVendors(),
  ])
  return (
    <AnalysisPageClient
      data={data}
      facilityId={facility.id}
      vendors={vendors}
    />
  )
}
