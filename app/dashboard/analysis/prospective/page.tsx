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
/**
 * `searchParams` is a PROMISE in Next 16 (verified against
 * nextjs.org/docs/app/api-reference/file-conventions/page, 2026-07-28) — it must
 * be awaited, not read synchronously.
 *
 * Reading it here is the fix for a deep link that was destroyed on arrival:
 * AnalysisPageClient hard-coded `initialTab`/`initialCompareId`/`initialVendorId`
 * to null even though the props existed and were threaded all the way down, so
 * ProspectiveClient started on its default tab and its "sync active tab → ?tab="
 * effect then router.replace()d the user's `?tab=compare` to `?tab=upload` on
 * mount. Feeding the real values makes the effect a no-op on arrival, because
 * activeTab already equals the incoming param. Charles 2026-07-28 sweep.
 */
function firstParam(v: string | string[] | undefined): string | null {
  if (Array.isArray(v)) return v[0] ?? null
  return v ?? null
}

export default async function AnalysisPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const { facility } = await requireFacility()
  const [data, vendors, params] = await Promise.all([
    getFacilityAnalysisData(),
    getVendors(),
    searchParams,
  ])
  return (
    <AnalysisPageClient
      data={data}
      facilityId={facility.id}
      vendors={vendors}
      initialTab={firstParam(params.tab)}
      initialCompareId={firstParam(params.compare)}
      initialVendorId={firstParam(params.vendor)}
    />
  )
}
