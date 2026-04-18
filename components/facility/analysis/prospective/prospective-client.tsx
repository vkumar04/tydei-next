"use client"

/**
 * Prospective-analysis orchestrator (spec §subsystem-5).
 *
 * Owns shared state (scored proposals, pricing analyses, selected vendor,
 * comparison selection, analysis phase) and delegates all UI to
 * {@link ProspectiveTabs}. Kept under 200 lines — the mega-file split is
 * the point of subsystem-5.
 */

import { useCallback, useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import type {
  AnalysisPhase,
  PricingFileAnalysisRecord,
  ProspectiveTabId,
  ScoredProposal,
  VendorOption,
} from "./types"
import { ProspectiveTabs } from "./prospective-tabs"

interface ProspectiveClientProps {
  facilityId: string
  vendors: VendorOption[]
  initialCompareId: string | null
  initialVendorId: string | null
  initialTab: string | null
}

const VALID_TABS: ProspectiveTabId[] = [
  "upload",
  "manual",
  "proposals",
  "pricing",
  "compare",
]

function asTab(value: string | null): ProspectiveTabId {
  if (value && (VALID_TABS as readonly string[]).includes(value)) {
    return value as ProspectiveTabId
  }
  return "upload"
}

export function ProspectiveClient({
  facilityId,
  vendors,
  initialCompareId,
  initialVendorId,
  initialTab,
}: ProspectiveClientProps) {
  void facilityId // reserved — future persist-to-DB hook

  const router = useRouter()
  const searchParams = useSearchParams()

  const [activeTab, setActiveTab] = useState<ProspectiveTabId>(() =>
    asTab(initialTab ?? (initialCompareId ? "compare" : null)),
  )
  const [scoredProposals, setScoredProposals] = useState<ScoredProposal[]>([])
  const [pricingAnalyses, setPricingAnalyses] = useState<
    PricingFileAnalysisRecord[]
  >([])
  const [selectedVendorId, setSelectedVendorId] = useState<string | null>(
    initialVendorId,
  )
  const [comparisonSelection, setComparisonSelection] = useState<string[]>(
    initialCompareId ? [initialCompareId] : [],
  )
  const [phase, setPhase] = useState<AnalysisPhase>("idle")

  // Latest scored proposal — used by Upload + Manual tabs for local render.
  const latestScored =
    scoredProposals.length > 0 ? scoredProposals[0]! : null

  // Sync active tab → ?tab= URL param so reloads stay put.
  useEffect(() => {
    const current = searchParams?.get("tab")
    if (current !== activeTab) {
      const params = new URLSearchParams(searchParams?.toString() ?? "")
      params.set("tab", activeTab)
      router.replace(`?${params.toString()}`, { scroll: false })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab])

  const handleProposalScored = useCallback((p: ScoredProposal) => {
    setScoredProposals((prev) => [p, ...prev])
  }, [])

  const handleRemoveProposal = useCallback((id: string) => {
    setScoredProposals((prev) => prev.filter((p) => p.id !== id))
    setComparisonSelection((prev) => prev.filter((x) => x !== id))
  }, [])

  const handlePricingAnalysisComplete = useCallback(
    (record: PricingFileAnalysisRecord) => {
      setPricingAnalyses((prev) => [record, ...prev])
    },
    [],
  )

  const handleToggleCompare = useCallback((id: string) => {
    setComparisonSelection((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id)
      if (prev.length >= 2) return prev
      return [...prev, id]
    })
  }, [])

  const handleOpenCompare = useCallback(() => {
    if (comparisonSelection.length === 2) {
      setActiveTab("compare")
    }
  }, [comparisonSelection.length])

  const handleClearCompare = useCallback(() => {
    setComparisonSelection([])
    setActiveTab("proposals")
  }, [])

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Evaluate Vendor Proposals</h1>
        <p className="text-muted-foreground">
          Score incoming vendor proposals, analyze pricing files against COG,
          and compare options side-by-side.
        </p>
      </div>

      <ProspectiveTabs
        activeTab={activeTab}
        onTabChange={setActiveTab}
        vendors={vendors}
        selectedVendorId={selectedVendorId}
        onVendorChange={setSelectedVendorId}
        scoredProposals={scoredProposals}
        latestScored={latestScored}
        onProposalScored={handleProposalScored}
        onRemoveProposal={handleRemoveProposal}
        pricingAnalyses={pricingAnalyses}
        onPricingAnalysisComplete={handlePricingAnalysisComplete}
        comparisonSelection={comparisonSelection}
        onToggleCompare={handleToggleCompare}
        onOpenCompare={handleOpenCompare}
        onClearCompare={handleClearCompare}
        phase={phase}
        onPhaseChange={setPhase}
      />
    </div>
  )
}
