"use client"

import { useState } from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { BarChart3, Gauge, Scale } from "lucide-react"

import { ProposalBuilder } from "@/components/vendor/prospective/proposal-builder"
import { ProspectiveHero } from "@/components/vendor/prospective/prospective-hero"
import { useVendorProposals } from "@/hooks/use-prospective"

import { OpportunitiesSection } from "./sections/OpportunitiesSection"
import { ProposalCards } from "./sections/ProposalCards"
import { DealScorerSection } from "./sections/DealScorerSection"
import { BenchmarksSection } from "./sections/BenchmarksSection"
import { AnalyticsSection } from "./sections/AnalyticsSection"

// ─── Main Component ────────────────────────────────────────────

interface VendorProspectiveClientProps {
  vendorId: string
  facilities: { id: string; name: string }[]
}

export function VendorProspectiveClient({ vendorId, facilities }: VendorProspectiveClientProps) {
  const { data: proposals, isLoading } = useVendorProposals(vendorId)
  const [activeTab, setActiveTab] = useState("opportunities")

  const totalProposals = proposals?.length ?? 0
  const totalProjectedSpend = proposals?.reduce((s, p) => s + p.totalProposedCost, 0) ?? 0

  return (
    <div className="space-y-6">
      <ProspectiveHero
        proposals={proposals ?? []}
        totalProposals={totalProposals}
        totalProjectedSpend={totalProjectedSpend}
      />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="opportunities">Opportunities</TabsTrigger>
          <TabsTrigger value="proposals">My Proposals</TabsTrigger>
          <TabsTrigger value="deal-scorer" className="gap-2">
            <Gauge className="h-4 w-4" />
            Deal Scorer
          </TabsTrigger>
          <TabsTrigger value="benchmarks" className="gap-2">
            <Scale className="h-4 w-4" />
            Benchmarks
          </TabsTrigger>
          <TabsTrigger value="analytics" className="gap-2">
            <BarChart3 className="h-4 w-4" />
            Analytics
          </TabsTrigger>
        </TabsList>

        <TabsContent value="opportunities" className="mt-4 space-y-4">
          <OpportunitiesSection
            proposals={proposals}
            isLoading={isLoading}
            totalProposals={totalProposals}
            totalProjectedSpend={totalProjectedSpend}
            onNewProposal={() => setActiveTab("new-proposal")}
          />
        </TabsContent>

        <TabsContent value="proposals" className="mt-4 space-y-4">
          <ProposalCards
            proposals={proposals ?? []}
            isLoading={isLoading}
            onNewProposal={() => setActiveTab("new-proposal")}
          />
        </TabsContent>

        <TabsContent value="deal-scorer" className="mt-4 space-y-4">
          <DealScorerSection facilities={facilities} />
        </TabsContent>

        <TabsContent value="benchmarks" className="mt-4 space-y-4">
          <BenchmarksSection vendorId={vendorId} />
        </TabsContent>

        <TabsContent value="analytics" className="mt-4 space-y-4">
          <AnalyticsSection proposals={proposals ?? []} isLoading={isLoading} />
        </TabsContent>

        {/* New Proposal Tab (no visible trigger — activated programmatically) */}
        <TabsContent value="new-proposal" className="mt-4 space-y-4">
          <ProposalBuilder
            vendorId={vendorId}
            facilities={facilities}
            onClose={() => setActiveTab("proposals")}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}
