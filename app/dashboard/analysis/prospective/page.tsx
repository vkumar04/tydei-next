import { requireFacility } from "@/lib/actions/auth"
import { getFacilityAnalysisData } from "@/lib/actions/facility-analysis-data"
import { AnalysisDashboardClient } from "@/components/facility/analysis/dashboard/analysis-dashboard-client"

/**
 * Facility Analysis dashboard — server component shell.
 *
 * Charles 2026-06-21: rebuilt from the old proposal-scoring hub into the CFO
 * financial dashboard (Current State → Prospective Impact → AI Prospective
 * Impact Engine). Measurable inputs are loaded from the facility's real data
 * (`getFacilityAnalysisData`); the deterministic engines recalc live on the
 * sliders, and Claude adds the narrative/recommendation layer on demand.
 */
export default async function AnalysisPage() {
  await requireFacility()
  const data = await getFacilityAnalysisData()
  return <AnalysisDashboardClient data={data} />
}
