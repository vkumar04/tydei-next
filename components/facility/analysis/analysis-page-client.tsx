"use client"

import { useState } from "react"
import { LineChart, FileUp } from "lucide-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

import type { FacilityAnalysisData } from "@/lib/actions/facility-analysis-data"
import { AnalysisDashboardClient } from "@/components/facility/analysis/dashboard/analysis-dashboard-client"
import { ProspectiveClient } from "@/components/facility/analysis/prospective/prospective-client"
import type { VendorOption } from "@/components/facility/analysis/prospective/types"

/**
 * Facility Analysis page shell — two surfaces:
 *  - "Current State": the CFO financial dashboard (modeled from live spend/cases).
 *  - "Evaluate Proposals": upload a vendor contract / pricing file (or enter
 *    manually) and score it — so contracts + pricing can be fed in for analysis,
 *    not just the data already in COG (Vick 2026-06-21).
 *
 * Outer tab is local state (the inner ProspectiveClient owns its own ?tab=).
 */
export function AnalysisPageClient({
  data,
  facilityId,
  vendors,
}: {
  data: FacilityAnalysisData
  facilityId: string
  vendors: VendorOption[]
}) {
  const [view, setView] = useState<"current-state" | "proposals">(
    "current-state",
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
              initialCompareId={null}
              initialVendorId={null}
              initialTab={null}
            />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
