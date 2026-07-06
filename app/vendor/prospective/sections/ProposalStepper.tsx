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

import { ProposalBuilder } from "@/components/vendor/prospective/proposal-builder"
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

  // External commands (edit / new) re-open the builder even when this
  // section is already mounted (the tab is forceMounted).
  useEffect(() => {
    if (editingProposalId || showBuilderInitially) setBuilderOpen(true)
  }, [editingProposalId, showBuilderInitially])

  // A card handoff arrives → bring the seeded Opportunity Engine into view
  // (same page — scroll, never navigate).
  const engineRef = useRef<HTMLDivElement | null>(null)
  const lastDealRef = useRef<string | null>(initialDeal?.proposalId ?? null)
  useEffect(() => {
    if (initialDeal && lastDealRef.current !== initialDeal.proposalId) {
      lastDealRef.current = initialDeal.proposalId
      engineRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
    }
  }, [initialDeal])

  return (
    <div className="space-y-6">
      {/* ── Create / edit the proposal (collapsible, same page) ────── */}
      <div className="rounded-lg border">
        <button
          type="button"
          className="flex w-full items-center justify-between px-4 py-3 text-left"
          onClick={() => setBuilderOpen((v) => !v)}
        >
          <span className="text-sm font-semibold">
            {editingProposalId ? "Edit proposal" : "Create a proposal"}
            <span className="ml-2 font-normal text-muted-foreground">
              — products, categories, terms
            </span>
          </span>
          {builderOpen ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <span className="flex items-center gap-1 text-sm text-muted-foreground">
              <Plus className="h-4 w-4" /> Open
            </span>
          )}
        </button>
        {builderOpen ? (
          <div className="border-t p-4">
            <ProposalBuilder
              vendorId={vendorId}
              facilities={facilities}
              editingProposalId={editingProposalId}
              onProposalCreated={(p) => {
                // Same page: collapse the builder; the parent pre-selects the
                // proposal in the Deal Scorer right below. No navigation.
                setBuilderOpen(false)
                onProposalCreated?.(p)
              }}
              onClose={() => {
                setBuilderOpen(false)
                onBuilderClosed?.()
              }}
            />
          </div>
        ) : null}
      </div>

      {/* ── Usage & pricing + the asks ─────────────────────────────── */}
      <DealScorerSection
        vendorId={vendorId}
        facilities={facilities}
        proposals={proposals}
        onDealAnalyzed={(deal) => {
          setAnalyzedDeal(deal)
          // Bring the seeded Opportunity Engine into view — same page.
          engineRef.current?.scrollIntoView({
            behavior: "smooth",
            block: "start",
          })
        }}
        preselectedProposalId={preselectedProposalId}
        embedded
      />

      {/* ── Opportunity & report ───────────────────────────────────── */}
      <div ref={engineRef}>
        <OpportunityEngineSection
          vendorId={vendorId}
          facilities={facilities}
          initialDeal={opportunityDeal}
        />
      </div>
    </div>
  )
}
