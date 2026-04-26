import { redirect } from "next/navigation"
import { requireFacility } from "@/lib/actions/auth"

/**
 * 2026-04-26 (Charles prod feedback): the legacy /dashboard/analysis
 * surface required picking from the facility's CURRENT active contracts
 * to run capital ROI on. Charles called this out: "There is no way for
 * them to enter a contract to analyze here as it should be — they do
 * not need to look at current contracts because those are being analyzed
 * in the Contracts tab already."
 *
 * The Prospective Analysis surface at /dashboard/analysis/prospective
 * already supports the right workflow: drop a PDF / fill a form for a
 * NOT-YET-SIGNED contract and run NPV / IRR / MACRS / spend-pattern
 * analysis. Redirect /dashboard/analysis there so users land on the
 * right tool by default. The legacy AnalysisClient (existing-contract
 * capital ROI) is preserved at lib + components paths in case a future
 * page wants to mount it again.
 */
export default async function AnalysisPage() {
  await requireFacility()
  redirect("/dashboard/analysis/prospective")
}
