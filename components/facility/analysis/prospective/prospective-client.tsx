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
import { usePersistedState } from "@/hooks/use-persisted-state"
import {
  useProposalEvaluations,
  useSaveProposalEvaluation,
  useUpdateProposalEvaluation,
  useDeleteProposalEvaluation,
  useDeleteProposalEvaluationsBySource,
} from "@/hooks/use-proposal-evaluations"

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
  const router = useRouter()
  const searchParams = useSearchParams()

  const [activeTab, setActiveTab] = useState<ProspectiveTabId>(() =>
    asTab(initialTab ?? (initialCompareId ? "compare" : null)),
  )
  // Scored proposals are now DB-backed (ProposalEvaluation) so they survive
  // refresh / device and can be reopened + re-run (2026-06-26 — was
  // localStorage). Pricing-file analyses stay localStorage for now.
  const { data: evaluations } = useProposalEvaluations()
  const scoredProposals: ScoredProposal[] = evaluations ?? []
  const { mutate: saveEvaluation } = useSaveProposalEvaluation()
  const { mutate: updateEvaluation } = useUpdateProposalEvaluation()
  const { mutate: deleteEvaluation } = useDeleteProposalEvaluation()
  const { mutate: deleteEvaluationsBySource } =
    useDeleteProposalEvaluationsBySource()
  // The just-scored proposal — kept for the inline Upload/Manual result render
  // so it shows immediately, before the list query refetches.
  const [lastScored, setLastScored] = useState<ScoredProposal | null>(null)
  // A saved evaluation reopened in the Manual tab for edit + re-score.
  const [rerunTarget, setRerunTarget] = useState<ScoredProposal | null>(null)
  const [pricingAnalyses, setPricingAnalyses] = usePersistedState<
    PricingFileAnalysisRecord[]
  >(`tydei:prospective:pricing:${facilityId}`, [])
  const [selectedVendorId, setSelectedVendorId] = useState<string | null>(
    initialVendorId,
  )
  const [comparisonSelection, setComparisonSelection] = useState<string[]>(
    initialCompareId ? [initialCompareId] : [],
  )
  const [phase, setPhase] = useState<AnalysisPhase>("idle")

  // Latest scored proposal — used by Upload + Manual tabs for local render.
  // Prefer the just-scored one (instant), fall back to the newest persisted.
  const latestScored =
    lastScored ?? (scoredProposals.length > 0 ? scoredProposals[0]! : null)

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

  const handleProposalScored = useCallback(
    (p: ScoredProposal, editingId?: string) => {
      setLastScored(p)
      const payload = {
        vendorName: p.vendorName,
        source: p.source,
        input: p.input,
        result: p.result,
        clauseAnalysis: p.clauseAnalysis,
      }
      // Re-run of a saved evaluation updates it in place; otherwise create.
      // Server assigns the real id; the list query refetches on success and
      // lastScored covers the inline render until then.
      if (editingId) {
        updateEvaluation({ id: editingId, input: payload })
      } else {
        saveEvaluation(payload)
      }
      setRerunTarget(null)
    },
    [saveEvaluation, updateEvaluation],
  )

  const handleRerun = useCallback((p: ScoredProposal) => {
    setRerunTarget(p)
    setActiveTab("manual")
  }, [])

  const handleRemoveProposal = useCallback(
    (id: string) => {
      deleteEvaluation(id)
      setComparisonSelection((prev) => prev.filter((x) => x !== id))
      setLastScored((prev) => (prev?.id === id ? null : prev))
    },
    [deleteEvaluation],
  )

  // Start-over for the Upload tab (bug-bash C1: "clear the data and start
  // over"). Drops every upload-sourced proposal — removing only the newest
  // would promote an OLDER upload to `latestScored` and resurrect a stale
  // verdict, the exact failure mode the reset exists to avoid. Manual-tab
  // proposals are untouched.
  const handleUploadReset = useCallback(() => {
    const removedIds = new Set(
      scoredProposals.filter((p) => p.source === "upload").map((p) => p.id),
    )
    deleteEvaluationsBySource("upload")
    setComparisonSelection((prev) => prev.filter((id) => !removedIds.has(id)))
    setLastScored((prev) => (prev?.source === "upload" ? null : prev))
    setPhase("idle")
  }, [scoredProposals, deleteEvaluationsBySource])

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
        rerunFrom={rerunTarget}
        onRerun={handleRerun}
        onUploadReset={handleUploadReset}
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
