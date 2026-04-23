/**
 * Case Costing — page shell (server component).
 *
 * Per docs/superpowers/specs/2026-04-18-case-costing-rewrite.md §4 (subsystem 1-5).
 *
 * This is the facility-scoped entry point for:
 *   - Cases list (with date-range + surgeon + CPT filters)
 *   - Surgeon scorecards + payor mix
 *   - Financial averages + per-surgeon margin chart
 *   - Contract compliance rollup
 *
 * Server responsibility is intentionally minimal: resolve the active facility
 * via `requireFacility`, then hand off to the client orchestrator which
 * manages tab state + TanStack Query wiring for each tab's server action.
 */
import { requireFacility } from "@/lib/actions/auth"
import { CaseCostingClient } from "@/components/facility/case-costing/case-costing-client"
import { CaseCostingExplainer } from "@/components/facility/case-costing/case-costing-explainer"

export default async function CaseCostingPage() {
  const { facility } = await requireFacility()

  return (
    <div className="space-y-6">
      <CaseCostingExplainer />
      <CaseCostingClient facilityId={facility.id} facilityName={facility.name} />
    </div>
  )
}
