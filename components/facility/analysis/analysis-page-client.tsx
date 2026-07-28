"use client"

import { useState } from "react"
import { LineChart, FileUp } from "lucide-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

import type { FacilityAnalysisData } from "@/lib/actions/facility-analysis-data"
import { AnalysisDashboardClient } from "@/components/facility/analysis/dashboard/analysis-dashboard-client"
import {
  ProspectiveClient,
  VALID_TABS,
} from "@/components/facility/analysis/prospective/prospective-client"
import type { VendorOption } from "@/components/facility/analysis/prospective/types"

/**
 * Facility Analysis page shell — two surfaces:
 *  - "Current State": the CFO financial dashboard (modeled from live spend/cases).
 *  - "Evaluate Proposals": upload a vendor contract / pricing file (or enter
 *    manually) and score it — so contracts + pricing can be fed in for analysis,
 *    not just the data already in COG (Vick 2026-06-21).
 *
 * Outer tab is local state, SEEDED from the URL. The inner ProspectiveClient
 * owns its own ?tab=; arriving with one implies the Evaluate Proposals view, so
 * the outer tab opens there rather than stranding the deep link behind
 * "Current State" (Charles 2026-07-28 sweep).
 */
export function AnalysisPageClient({
  data,
  facilityId,
  vendors,
  initialTab = null,
  initialCompareId = null,
  initialVendorId = null,
}: {
  data: FacilityAnalysisData
  facilityId: string
  vendors: VendorOption[]
  /** Inner prospective tab from ?tab= — see ProspectiveClient. */
  initialTab?: string | null
  /** ?compare= — a proposal id to open the comparison on. */
  initialCompareId?: string | null
  /** ?vendor= — preselects the vendor filter. */
  initialVendorId?: string | null
}) {
  // Only a VALID inner tab implies the proposals view. A stale or bogus ?tab=
  // (e.g. `analytics`, removed 2026-07-27) must fall back to Current State
  // rather than opening a view the param no longer belongs to — pinned by
  // tests/e2e/cross-cutting-invariants.spec.ts "falls back instead of crashing".
  const hasRealTab =
    !!initialTab && (VALID_TABS as readonly string[]).includes(initialTab)
  const [view, setView] = useState<"current-state" | "proposals">(
    hasRealTab || initialCompareId || initialVendorId
      ? "proposals"
      : "current-state",
  )

  return (
    <div className="p-6">
      <Tabs value={view} onValueChange={(v) => setView(v as typeof view)}>
        <TabsList>
          <TabsTrigger value="current-state" className="gap-2">
            <LineChart className="h-4 w-4" />
            Current State
          </TabsTrigger>
          <TabsTrigger value="proposals" className="gap-2">
            <FileUp className="h-4 w-4" />
            Evaluate Proposals
          </TabsTrigger>
        </TabsList>

        <TabsContent value="current-state" className="mt-2">
          {/* Dashboard renders its own padding; strip the page padding here. */}
          <div className="-mx-6">
            <AnalysisDashboardClient data={data} />
          </div>
        </TabsContent>

        <TabsContent value="proposals" className="mt-2">
          <div className="-mx-6">
            <ProspectiveClient
              facilityId={facilityId}
              vendors={vendors}
              initialCompareId={initialCompareId}
              initialVendorId={initialVendorId}
              initialTab={initialTab}
            />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
