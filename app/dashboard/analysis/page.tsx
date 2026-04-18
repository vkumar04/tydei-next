import { requireFacility } from "@/lib/actions/auth"
import { AnalysisClient } from "@/components/facility/analysis/analysis-client"

/**
 * Financial Analysis — capital ROI page (subsystems 1-7).
 *
 * Server shell that resolves the active facility scope and renders the
 * client orchestrator. All heavy lifting (form state, TanStack Query
 * data loading, recharts rendering) lives in the client tree. See
 * docs/superpowers/specs/2026-04-18-financial-analysis-rewrite.md.
 */
export default async function AnalysisPage() {
  const { facility } = await requireFacility()

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight text-balance">
          Financial Analysis
        </h1>
        <p className="text-muted-foreground">
          Capital-contract ROI: NPV, IRR, MACRS depreciation, rebates, and
          price-lock opportunity cost.
        </p>
      </div>

      <AnalysisClient facilityId={facility.id} />
    </div>
  )
}
