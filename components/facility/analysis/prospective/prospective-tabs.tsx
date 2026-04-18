"use client"

/**
 * Tab router for the prospective-analysis page (spec §subsystem-5).
 *
 * Renders the 5 tabs (Upload / Manual / Proposals / Pricing / Compare) and
 * dispatches to each tab component. Holds no state — the orchestrator
 * ({@link ProspectiveClient}) owns the state shared between tabs.
 */

import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"
import {
  BarChart3,
  FileSpreadsheet,
  FileText,
  GitCompareArrows,
  Pencil,
  Upload,
} from "lucide-react"
import type {
  AnalysisPhase,
  PricingFileAnalysisRecord,
  ProspectiveTabId,
  ScoredProposal,
  VendorOption,
} from "./types"
import { UploadProposalTab } from "./upload-proposal-tab"
import { ManualEntryTab } from "./manual-entry-tab"
import { ProposalsTab } from "./proposals-tab"
import { PricingTab } from "./pricing-tab"
import { ComparisonTab } from "./comparison-tab"

interface ProspectiveTabsProps {
  activeTab: ProspectiveTabId
  onTabChange: (tab: ProspectiveTabId) => void

  vendors: VendorOption[]
  selectedVendorId: string | null
  onVendorChange: (id: string | null) => void

  scoredProposals: ScoredProposal[]
  latestScored: ScoredProposal | null
  onProposalScored: (p: ScoredProposal) => void
  onRemoveProposal: (id: string) => void

  pricingAnalyses: PricingFileAnalysisRecord[]
  onPricingAnalysisComplete: (record: PricingFileAnalysisRecord) => void

  comparisonSelection: string[]
  onToggleCompare: (id: string) => void
  onOpenCompare: () => void
  onClearCompare: () => void

  phase: AnalysisPhase
  onPhaseChange: (phase: AnalysisPhase) => void
}

export function ProspectiveTabs(props: ProspectiveTabsProps) {
  const {
    activeTab,
    onTabChange,
    vendors,
    selectedVendorId,
    onVendorChange,
    scoredProposals,
    latestScored,
    onProposalScored,
    onRemoveProposal,
    pricingAnalyses,
    onPricingAnalysisComplete,
    comparisonSelection,
    onToggleCompare,
    onOpenCompare,
    onClearCompare,
    phase,
    onPhaseChange,
  } = props

  const selectedProposalsForCompare = scoredProposals.filter((p) =>
    comparisonSelection.includes(p.id),
  )

  return (
    <Tabs
      value={activeTab}
      onValueChange={(v) => onTabChange(v as ProspectiveTabId)}
    >
      <TabsList>
        <TabsTrigger value="upload" className="gap-2">
          <Upload className="h-4 w-4" />
          Upload
        </TabsTrigger>
        <TabsTrigger value="manual" className="gap-2">
          <Pencil className="h-4 w-4" />
          Manual
        </TabsTrigger>
        <TabsTrigger value="proposals" className="gap-2">
          <FileText className="h-4 w-4" />
          Proposals ({scoredProposals.length})
        </TabsTrigger>
        <TabsTrigger value="pricing" className="gap-2">
          <FileSpreadsheet className="h-4 w-4" />
          Pricing
        </TabsTrigger>
        <TabsTrigger value="compare" className="gap-2">
          <GitCompareArrows className="h-4 w-4" />
          Compare
        </TabsTrigger>
        <TabsTrigger value="_unused" className="gap-2 hidden" disabled>
          <BarChart3 className="h-4 w-4" />
        </TabsTrigger>
      </TabsList>

      <TabsContent value="upload" className="space-y-6 mt-6">
        <UploadProposalTab
          vendors={vendors}
          selectedVendorId={selectedVendorId}
          onVendorChange={onVendorChange}
          onProposalScored={onProposalScored}
          lastScored={
            latestScored && latestScored.source === "upload"
              ? latestScored
              : null
          }
          phase={phase}
          onPhaseChange={onPhaseChange}
        />
      </TabsContent>

      <TabsContent value="manual" className="space-y-6 mt-6">
        <ManualEntryTab
          onProposalScored={onProposalScored}
          lastScored={
            latestScored && latestScored.source === "manual"
              ? latestScored
              : null
          }
          phase={phase}
          onPhaseChange={onPhaseChange}
        />
      </TabsContent>

      <TabsContent value="proposals" className="space-y-6 mt-6">
        <ProposalsTab
          proposals={scoredProposals}
          comparisonSelection={comparisonSelection}
          onToggleCompare={onToggleCompare}
          onOpenCompare={onOpenCompare}
          onRemove={onRemoveProposal}
        />
      </TabsContent>

      <TabsContent value="pricing" className="space-y-6 mt-6">
        <PricingTab
          vendors={vendors}
          selectedVendorId={selectedVendorId}
          onVendorChange={onVendorChange}
          onAnalysisComplete={onPricingAnalysisComplete}
          analyses={pricingAnalyses}
        />
      </TabsContent>

      <TabsContent value="compare" className="space-y-6 mt-6">
        <ComparisonTab
          proposals={selectedProposalsForCompare}
          onClear={onClearCompare}
        />
      </TabsContent>
    </Tabs>
  )
}
