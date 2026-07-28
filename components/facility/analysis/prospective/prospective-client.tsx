"use client"

/**
 * Prospective-analysis orchestrator (spec §subsystem-5).
 *
 * Owns shared state (scored proposals, pricing analyses, selected vendor,
 * comparison selection, analysis phase) and delegates all UI to
 * {@link ProspectiveTabs}. Kept under 200 lines — the mega-file split is
 * the point of subsystem-5.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import type {
  AnalysisPhase,
  PricingFileAnalysisRecord,
  ProspectiveTabId,
  ScoredProposal,
  VendorOption,
} from "./types"
import { isUnsavedEvaluationId } from "./types"
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

/**
 * Exported so AnalysisPageClient can decide whether an incoming ?tab= is real
 * before switching the OUTER view to Evaluate Proposals. One list, one source of
 * truth — duplicating it is how `?tab=analytics` (a tab removed on 2026-07-27)
 * would start opening a view it no longer belongs to.
 */
export const VALID_TABS: ProspectiveTabId[] = [
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
  const { mutateAsync: saveEvaluationAsync } = useSaveProposalEvaluation()
  const { mutate: updateEvaluation } = useUpdateProposalEvaluation()
  const { mutate: deleteEvaluation } = useDeleteProposalEvaluation()
  const { mutate: deleteEvaluationsBySource } =
    useDeleteProposalEvaluationsBySource()
  // The just-scored proposal — kept for the inline Upload/Manual result render
  // so it shows immediately, before the list query refetches.
  const [lastScored, setLastScored] = useState<ScoredProposal | null>(null)
  // Maps the just-scored proposal's client-minted id (`upl-…`/`man-…`) to the
  // persisted row id, so a follow-on score of the SAME proposal (the price-file
  // re-score) UPDATEs that row instead of creating a duplicate, and delete can
  // clear the inline render (bug-bash F-B1 / F-C7).
  const savedIdRef = useRef<{ clientId: string; serverId: string } | null>(
    null,
  )
  // In-flight create for a client id — a follow-on score of the SAME proposal
  // (price-file re-score, legal-scan attach) arriving before the save
  // round-trips chains onto this promise as an UPDATE instead of racing into
  // a second create.
  const pendingSaveRef = useRef<{
    clientId: string
    promise: Promise<{ id: string } | null>
  } | null>(null)
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
        signals: p.signals ?? null,
      }
      // Resolve which persisted row this score belongs to: an explicit
      // editingId (Manual-tab re-run), the proposal's own id when it's already
      // a persisted row (re-score after reload), or the just-saved row for the
      // same client id (price-file re-score before/after the list refetched).
      // Only when none match is this a NEW evaluation (F-B1: the price-file
      // re-score used to fall through here and persist a duplicate row).
      const targetId =
        editingId ??
        (!isUnsavedEvaluationId(p.id)
          ? p.id
          : savedIdRef.current?.clientId === p.id
            ? savedIdRef.current.serverId
            : undefined)
      if (targetId) {
        updateEvaluation({ id: targetId, input: payload })
        savedIdRef.current = { clientId: p.id, serverId: targetId }
        // Manual re-run: STAY in edit mode (rerunTarget keeps the same id, so
        // the form isn't remounted) — iterative tweak-and-rescore keeps
        // updating the same row (F-C2). Cancel / tab-switch exits.
      } else if (pendingSaveRef.current?.clientId === p.id) {
        // Save still in flight for this proposal — chain as an update.
        const prior = pendingSaveRef.current.promise
        pendingSaveRef.current = {
          clientId: p.id,
          promise: prior.then((row) => {
            if (row) updateEvaluation({ id: row.id, input: payload })
            return row
          }),
        }
      } else {
        const promise = saveEvaluationAsync(payload)
          .then((row) => {
            savedIdRef.current = { clientId: p.id, serverId: row.id }
            // Adopt the server id so follow-on re-scores and deletes resolve
            // to the persisted row.
            setLastScored((prev) =>
              prev?.id === p.id
                ? { ...prev, id: row.id, createdAt: row.createdAt }
                : prev,
            )
            return row
          })
          .catch(() => null)
        pendingSaveRef.current = { clientId: p.id, promise }
      }
    },
    [saveEvaluationAsync, updateEvaluation],
  )

  const handleRerun = useCallback((p: ScoredProposal) => {
    setRerunTarget(p)
    setActiveTab("manual")
  }, [])

  const handleCancelRerun = useCallback(() => {
    setRerunTarget(null)
  }, [])

  // Leaving the Manual tab exits edit mode — otherwise a later, unrelated
  // manual score would silently UPDATE the reopened evaluation (F-C1).
  const handleTabChange = useCallback((tab: ProspectiveTabId) => {
    setRerunTarget((prev) => (tab === "manual" ? prev : null))
    setActiveTab(tab)
  }, [])

  const handleRemoveProposal = useCallback(
    (id: string) => {
      deleteEvaluation(id)
      setComparisonSelection((prev) => prev.filter((x) => x !== id))
      setLastScored((prev) =>
        prev?.id === id || savedIdRef.current?.serverId === id ? null : prev,
      )
      setRerunTarget((prev) => (prev?.id === id ? null : prev))
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
        onTabChange={handleTabChange}
        vendors={vendors}
        selectedVendorId={selectedVendorId}
        onVendorChange={setSelectedVendorId}
        scoredProposals={scoredProposals}
        latestScored={latestScored}
        onProposalScored={handleProposalScored}
        onRemoveProposal={handleRemoveProposal}
        rerunFrom={rerunTarget}
        onRerun={handleRerun}
        onCancelRerun={handleCancelRerun}
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
