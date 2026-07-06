"use client"

import { useState } from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { BarChart3, Gauge, Scale } from "lucide-react"

import { ProspectiveHero } from "@/components/vendor/prospective/prospective-hero"
import { useVendorProposals } from "@/hooks/use-prospective"

import { ProposalCards } from "./sections/ProposalCards"
import { ProposalStepper } from "./sections/ProposalStepper"
import { BenchmarksSection } from "./sections/BenchmarksSection"
import { type OppEngineHandoff } from "./sections/OpportunityEngineSection"
import { AnalyticsSection } from "./sections/AnalyticsSection"

// ─── Main Component ────────────────────────────────────────────

interface VendorProspectiveClientProps {
  vendorId: string
  facilities: { id: string; name: string }[]
}

export function VendorProspectiveClient({ vendorId, facilities }: VendorProspectiveClientProps) {
  const { data: proposals, isLoading } = useVendorProposals(vendorId)
  const [activeTab, setActiveTab] = useState("opportunities")
  const [oppHandoff, setOppHandoff] = useState<OppEngineHandoff | null>(null)
  // A just-created (or opened) proposal to pre-select in the Deal Scorer.
  const [preselectedProposalId, setPreselectedProposalId] = useState<string | null>(null)
  // A saved proposal opened in the builder for in-place editing.
  const [editingProposalId, setEditingProposalId] = useState<string | null>(null)
  // "New proposal" entry → the Proposals workspace with the builder expanded.
  // Charles 2026-07-05 ("make sure there is no next — it's all on the same
  // page"): the hidden new-proposal tab is GONE; builder + Deal Scorer +
  // Opportunity Engine all live stacked on the Proposals tab.
  const [showBuilder, setShowBuilder] = useState(false)

  const totalProposals = proposals?.length ?? 0
  // Facility projected ANNUAL spend (the user-entered assumption) — falls back
  // to the proposed catalog cost only when a proposal has no spend assumption.
  // (Was Σ totalProposedCost = catalog cost, mislabeled as projected spend.)
  const totalProjectedSpend =
    proposals?.reduce((s, p) => s + (p.projectedSpend ?? p.totalProposedCost), 0) ?? 0

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
          <TabsTrigger value="proposals" className="gap-2">
            <Gauge className="h-4 w-4" />
            Proposals
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

        {/* Opportunities = the list of past proposals (like My Contracts). */}
        <TabsContent value="opportunities" className="mt-4 space-y-4">
          <ProposalCards
            proposals={proposals ?? []}
            isLoading={isLoading}
            onNewProposal={() => {
              setEditingProposalId(null)
              setShowBuilder(true)
              setActiveTab("proposals")
            }}
            onEditProposal={(id) => {
              setEditingProposalId(id)
              setShowBuilder(true)
              setActiveTab("proposals")
            }}
            onAnalyzeInOpportunityEngine={(deal) => {
              // Mutually exclusive with a builder-save preselect (V-C1).
              setPreselectedProposalId(null)
              setOppHandoff(deal)
              setActiveTab("proposals")
            }}
          />
        </TabsContent>

        {/* Proposals = the ONE-PAGE deal workspace: create/edit proposal +
            Deal Scorer + Opportunity Engine stacked — no steps, no swaps
            (Charles 2026-07-05). forceMount: Radix unmounts inactive tab
            content, which would discard unsaved deal work on a peek at
            Benchmarks — the workspace stays mounted and is CSS-hidden. */}
        <TabsContent
          value="proposals"
          forceMount
          className="mt-4 space-y-4 data-[state=inactive]:hidden"
        >
          <ProposalStepper
            vendorId={vendorId}
            facilities={facilities}
            proposals={proposals ?? []}
            initialDeal={oppHandoff}
            preselectedProposalId={preselectedProposalId}
            editingProposalId={editingProposalId}
            showBuilderInitially={showBuilder}
            onBuilderClosed={() => {
              setShowBuilder(false)
              setEditingProposalId(null)
            }}
            onProposalCreated={(p) => {
              // Same page: the new proposal pre-selects in the Deal Scorer
              // below; clear any stale card handoff so the freshly saved deal
              // owns the flow.
              setShowBuilder(false)
              setEditingProposalId(null)
              setOppHandoff(null)
              setPreselectedProposalId(p.id)
            }}
          />
        </TabsContent>

        <TabsContent value="benchmarks" className="mt-4 space-y-4">
          <BenchmarksSection vendorId={vendorId} />
        </TabsContent>

        <TabsContent value="analytics" className="mt-4 space-y-4">
          <AnalyticsSection proposals={proposals ?? []} isLoading={isLoading} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
