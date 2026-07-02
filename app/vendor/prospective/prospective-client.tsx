"use client"

import { useState } from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { BarChart3, Gauge, Scale } from "lucide-react"

import { ProposalBuilder } from "@/components/vendor/prospective/proposal-builder"
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
  // A just-created (or opened) proposal to pre-load into the stepper's Step 1.
  const [preselectedProposalId, setPreselectedProposalId] = useState<string | null>(null)
  // A saved proposal opened in the builder for in-place editing.
  const [editingProposalId, setEditingProposalId] = useState<string | null>(null)

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
              setActiveTab("new-proposal")
            }}
            onEditProposal={(id) => {
              setEditingProposalId(id)
              setActiveTab("new-proposal")
            }}
            onAnalyzeInOpportunityEngine={(deal) => {
              // Mutually exclusive with a builder-save preselect: a stale
              // preselect would force the stepper back to Step 1 and defeat
              // this jump to the Opportunity Engine (bug-bash V-C1).
              setPreselectedProposalId(null)
              setOppHandoff(deal)
              setActiveTab("proposals")
            }}
          />
        </TabsContent>

        {/* Proposals = the guided stepper (Usage & Pricing → Opportunity).
            forceMount: Radix unmounts inactive tab content, which used to
            discard unsaved Deal-Scorer work on a peek at Benchmarks — the
            stepper stays mounted and is CSS-hidden instead. */}
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
          />
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
            editingProposalId={editingProposalId}
            onProposalCreated={(p) => {
              // Save → continue into the Deal Scorer pre-loaded with this deal.
              // Clears any card-handoff so Step 1 is the landing step (V-C1).
              setEditingProposalId(null)
              setOppHandoff(null)
              setPreselectedProposalId(p.id)
              setActiveTab("proposals")
            }}
            onClose={() => {
              setEditingProposalId(null)
              setActiveTab("opportunities")
            }}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}
