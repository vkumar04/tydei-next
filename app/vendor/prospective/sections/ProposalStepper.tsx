"use client"

/**
 * ONE-PAGE deal workspace (Charles 2026-07-05 "make sure there is no next —
 * it's all on the same page"; supersedes the two-step stepper of 2026-06-24).
 *
 * The Proposals tab stacks everything on a single scroll:
 *   [Create / Edit proposal]  — collapsible ProposalBuilder
 *   [Usage & Pricing]         — DealScorerSection (asks + Analyze)
 *   [Opportunity & Report]    — OpportunityEngineSection
 * Saving a proposal pre-selects it in the Deal Scorer below (no navigation);
 * Analyze feeds the Opportunity Engine below it (initialDeal) — the page
 * never swaps or advances, it just fills in as you scroll.
 */

import { useEffect, useRef, useState } from "react"
import { ChevronUp, Plus } from "lucide-react"

import {
  ProposalBuilder,
  type ProposalBuilderHandle,
} from "@/components/vendor/prospective/proposal-builder"
import { DealScorerSection } from "./DealScorerSection"
import {
  OpportunityEngineSection,
  type OppEngineHandoff,
} from "./OpportunityEngineSection"
import type { VendorProposal } from "@/lib/actions/prospective"

interface FacilityOption {
  id: string
  name: string
}

export function ProposalStepper({
  vendorId,
  facilities,
  proposals,
  initialDeal,
  preselectedProposalId = null,
  editingProposalId = null,
  showBuilderInitially = false,
  onBuilderClosed,
  onProposalCreated,
}: {
  vendorId: string
  facilities: FacilityOption[]
  proposals: VendorProposal[]
  /** External handoff (My-Proposals "Opportunity Engine" card button). */
  initialDeal?: OppEngineHandoff | null
  /** A just-created/opened proposal to pre-select in the Deal Scorer. */
  preselectedProposalId?: string | null
  /** A saved proposal opened for in-place editing (expands the builder). */
  editingProposalId?: string | null
  /** "New proposal" entry point — the builder starts expanded. */
  showBuilderInitially?: boolean
  onBuilderClosed?: () => void
  onProposalCreated?: (proposal: VendorProposal) => void
}) {
  const [builderOpen, setBuilderOpen] = useState(
    showBuilderInitially || Boolean(editingProposalId),
  )
  // The deal analyzed above auto-seeds the Opportunity Engine below (falls
  // back to an external card handoff).
  const [analyzedDeal, setAnalyzedDeal] = useState<OppEngineHandoff | null>(
    null,
  )
  const opportunityDeal = analyzedDeal ?? initialDeal ?? null

  // Live builder selection (categories + facility) streamed up from the
  // ProposalBuilder so the Deal Scorer + Opportunity Engine below inherit them
  // BEFORE "Analyze deal" persists anything (Charles 2026-07-06 "categories not
  // coming over" / "entering facility twice" / "still asking these questions").
  const [builderDraft, setBuilderDraft] = useState<{
    productCategories: string[]
    facilityId: string | null
    facilityName: string | null
  }>({ productCategories: [], facilityId: null, facilityName: null })
  // The ONE workspace facility: the builder's live pick wins, falling back to a
  // just-analyzed / externally-handed deal. Locks the Opportunity Engine's
  // facility selectors so the facility is entered exactly once.
  const workspaceFacilityId =
    builderDraft.facilityId ??
    analyzedDeal?.facilityId ??
    initialDeal?.facilityId ??
    null

  // External commands (edit / new) re-open the builder even when this
  // section is already mounted (the tab is forceMounted).
  useEffect(() => {
    if (editingProposalId || showBuilderInitially) setBuilderOpen(true)
  }, [editingProposalId, showBuilderInitially])

  // Single-commit bridge: the builder exposes an imperative save that the Deal
  // Scorer's "Analyze deal" calls, so there is no mid-page Save button
  // (Charles 2026-07-06). Tracks the proposal id it just attached so the same
  // proposal isn't re-created on a re-analyze.
  const builderRef = useRef<ProposalBuilderHandle>(null)
  const [bridgedProposalId, setBridgedProposalId] = useState<string | null>(null)

  // A card handoff arrives → bring the seeded Opportunity Engine into view
  // (same page — scroll, never navigate).
  const engineRef = useRef<HTMLElement | null>(null)
  const lastDealRef = useRef<string | null>(initialDeal?.proposalId ?? null)
  useEffect(() => {
    if (initialDeal && lastDealRef.current !== initialDeal.proposalId) {
      lastDealRef.current = initialDeal.proposalId
      engineRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
    }
  }, [initialDeal])

  return (
    <div className="space-y-8">
      {/* ① Build the proposal (collapsible, same page) ───────────── */}
      <section className="space-y-3">
        <button
          type="button"
          className="flex w-full items-center justify-between text-left"
          onClick={() => setBuilderOpen((v) => !v)}
        >
          <StepHeader
            num={1}
            title={editingProposalId ? "Edit the proposal" : "Build the proposal"}
            desc="Facility, products, categories, and terms"
          />
          {builderOpen ? (
            <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <span className="flex shrink-0 items-center gap-1 text-sm text-muted-foreground">
              <Plus className="h-4 w-4" /> Open
            </span>
          )}
        </button>
        {builderOpen ? (
          <div className="rounded-lg border p-4">
            <ProposalBuilder
              ref={builderRef}
              vendorId={vendorId}
              facilities={facilities}
              editingProposalId={editingProposalId}
              embedded
              onDraftChange={setBuilderDraft}
              onAutoAttach={(p) => {
                // Bridge save from "Analyze deal": attach the proposal WITHOUT
                // collapsing/resetting the builder (Charles 2026-07-06).
                setBridgedProposalId(p.id)
                onProposalCreated?.(p)
              }}
              onClose={() => {
                setBuilderOpen(false)
                onBuilderClosed?.()
              }}
            />
          </div>
        ) : null}
      </section>

      {/* ② Score the deal ─────────────────────────────────────────── */}
      <section className="space-y-3">
        <StepHeader
          num={2}
          title="Score the deal"
          desc="Set Floor / Target / Ask per product, then Analyze — it saves and scores in one step"
        />
      <DealScorerSection
        vendorId={vendorId}
        facilities={facilities}
        proposals={proposals}
        builderCategories={builderDraft.productCategories}
        builderFacilityId={builderDraft.facilityId}
        onDealAnalyzed={(deal) => {
          setAnalyzedDeal(deal)
          // Bring the seeded Opportunity Engine into view — same page.
          engineRef.current?.scrollIntoView({
            behavior: "smooth",
            block: "start",
          })
        }}
        preselectedProposalId={preselectedProposalId ?? bridgedProposalId}
        embedded
        beforeAnalyze={async () => {
          // Only bridge-save when the builder is open with unsaved content and
          // nothing is attached yet — otherwise the Deal Scorer analyzes with
          // whatever is already attached.
          if (!builderOpen || bridgedProposalId || preselectedProposalId)
            return null
          if (!builderRef.current?.hasContent()) return null
          const p = await builderRef.current.submit()
          if (!p) return null
          return { proposalId: p.id, facilityId: p.facilityIds[0] ?? null }
        }}
      />
      </section>

      {/* ③ Opportunity & report ───────────────────────────────────── */}
      <section className="space-y-3" ref={engineRef}>
        <StepHeader
          num={3}
          title="Opportunity & report"
          desc="Model the scenario levers and export the deal report"
        />
        <OpportunityEngineSection
          vendorId={vendorId}
          facilities={facilities}
          initialDeal={opportunityDeal}
          lockedFacilityId={workspaceFacilityId}
        />
      </section>
    </div>
  )
}

/** Numbered step marker for the one-page workspace (Charles 2026-07-06 — give
 *  the long single scroll a 1 → 2 → 3 structure). */
function StepHeader({
  num,
  title,
  desc,
}: {
  num: number
  title: string
  desc: string
}) {
  // Phrasing-safe (spans, not h2/p) — step 1's header sits inside a toggle
  // <button>, where flow content would be invalid.
  return (
    <span className="flex items-center gap-3">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
        {num}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold leading-tight">
          {title}
        </span>
        <span className="block text-xs text-muted-foreground">{desc}</span>
      </span>
    </span>
  )
}
