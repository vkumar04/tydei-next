"use client"

import { useEffect, useMemo, useRef, useState, useCallback, forwardRef, useImperativeHandle } from "react"
import { Separator } from "@/components/ui/separator"
import { toast } from "sonner"
import {
  useCreateProposal,
  useUpdateProposal,
  useVendorProposalDetail,
} from "@/hooks/use-prospective"
import { useMyVendorDivisions } from "@/hooks/use-divisions"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Save } from "lucide-react"
import type { ProposedPricingItem, VendorProposal } from "@/lib/actions/prospective"
import { DealScoreView } from "./deal-score-view"
import type { DealScore } from "@/lib/actions/prospective"

import { ProposalHeader } from "./builder/proposal-header"
import { FacilitySelector } from "./builder/facility-selector"
import { ContractParameters } from "./builder/contract-parameters"
import { DealNotes } from "./builder/deal-notes"
import { ProductsSection } from "./builder/products-section"
import { ContractTerms } from "./builder/contract-terms"
import { ProposalActions } from "./builder/proposal-actions"
import {
  handlePricingRowsImport,
  handleUsageRowsImport,
  generateTermsFromNotes,
} from "./builder/file-handlers"
import type { ResolvedMapping } from "@/components/shared/uploads/field-spec"
import { estimateProposalTerms } from "@/lib/prospective-analysis/proposal-term-estimate"
import { resolveProposalPersistTarget } from "@/lib/prospective/builder-session"
import type {
  NewProposalState,
  ProspectiveFacility,
  ProspectiveTerm,
  TermSuggestionsState,
  FileUploadProgressState,
} from "./builder/types"
import { PRODUCT_CATEGORIES } from "./builder/types"

interface ProposalBuilderProps {
  vendorId: string
  facilities: { id: string; name: string }[]
  editingProposalId?: string | null
  onClose?: () => void
  /** Called after a proposal is saved via the explicit Save button, with the
   *  created row — lets the parent continue into the Deal Scorer. */
  onProposalCreated?: (proposal: VendorProposal) => void
  /**
   * One-page flow (Charles 2026-07-06): hide the explicit Save button — the
   * Deal Scorer's "Analyze deal" drives the save via the imperative handle so
   * there is no mid-page commit. `onAutoAttach` fires when that bridge save
   * lands, so the parent can attach the proposal WITHOUT collapsing the
   * builder or resetting the form.
   */
  embedded?: boolean
  onAutoAttach?: (proposal: VendorProposal) => void
  /**
   * One-page flow (Charles 2026-07-06 "categories not coming over" / "entering
   * facility twice"): stream the builder's LIVE category + facility selection
   * to the parent so the Deal Scorer + Opportunity Engine below can inherit
   * them BEFORE "Analyze deal" persists the proposal. Without this the builder
   * is a one-way sink and the sections below stay empty until Analyze.
   */
  onDraftChange?: (draft: {
    productCategories: string[]
    facilityId: string | null
    facilityName: string | null
  }) => void
}

/** Imperative surface for the one-page "Analyze deal" bridge. */
export interface ProposalBuilderHandle {
  submit: () => Promise<VendorProposal | null>
  hasContent: () => boolean
}

export const ProposalBuilder = forwardRef<
  ProposalBuilderHandle,
  ProposalBuilderProps
>(function ProposalBuilder(
  { vendorId, facilities, editingProposalId, onClose, onProposalCreated, embedded = false, onAutoAttach, onDraftChange },
  ref,
) {
  const createMutation = useCreateProposal()
  const updateMutation = useUpdateProposal()
  const { data: editDetail, isFetching: editDetailFetching } =
    useVendorProposalDetail(editingProposalId ?? null)
  // Division picker (hard isolation): a member attached to 2+ divisions
  // chooses which division the new proposal belongs to — otherwise the server
  // stamps their only division (restricted) or null (enterprise). "" = let
  // the server default.
  const { data: myDivisions } = useMyVendorDivisions()
  const [vendorDivisionId, setVendorDivisionId] = useState<string>("")
  const showDivisionPicker =
    !editingProposalId &&
    (myDivisions?.restricted ?? false) &&
    (myDivisions?.divisions.length ?? 0) >= 2
  const [score, setScore] = useState<DealScore | null>(null)

  const [customFacilities, setCustomFacilities] = useState<ProspectiveFacility[]>([])
  const [customCategories, setCustomCategories] = useState<string[]>([])
  const [showAddFacility, setShowAddFacility] = useState(false)
  const [showAddCategory, setShowAddCategory] = useState(false)
  const [newFacilityName, setNewFacilityName] = useState("")
  const [newCategoryName, setNewCategoryName] = useState("")

  const allFacilities = [...facilities, ...customFacilities]
  const allCategories = [...PRODUCT_CATEGORIES, ...customCategories]

  const [fileUploadProgress, setFileUploadProgress] = useState<FileUploadProgressState>({
    isLoading: false, type: null, progress: 0, message: "",
  })

  const [termSuggestions, setTermSuggestions] = useState<TermSuggestionsState>({
    data: null,
  })

  const [newProposal, setNewProposal] = useState<NewProposalState>({
    proposalName: "",
    facilityId: "",
    facilityName: "",
    isMultiFacility: false,
    facilities: [],
    productCategory: "",
    productCategories: [],
    isGrouped: false,
    groupName: "",
    contractLength: 24,
    projectedSpend: 0,
    projectedVolume: 0,
    totalOpportunity: 0,
    terms: [],
    products: [],
    marketShareCommitment: 50,
    gpoFee: 3,
    aiNotes: "",
  })

  // Stream live category + facility selection up to the one-page parent so the
  // Deal Scorer + Opportunity Engine inherit them before Analyze (Charles
  // 2026-07-06). Ref-hold the callback so its identity churn doesn't re-fire;
  // depend only on the actual values. Categories live in EITHER the single
  // `productCategory` (legacy) or the `productCategories` array — merge both.
  const onDraftChangeRef = useRef(onDraftChange)
  onDraftChangeRef.current = onDraftChange
  const draftCategoriesKey = [
    newProposal.productCategory,
    ...newProposal.productCategories,
  ]
    .filter(Boolean)
    .join(" ")
  useEffect(() => {
    const cats = Array.from(
      new Set(
        [newProposal.productCategory, ...newProposal.productCategories].filter(
          Boolean,
        ),
      ),
    )
    onDraftChangeRef.current?.({
      productCategories: cats,
      facilityId: newProposal.facilityId || null,
      facilityName: newProposal.facilityName || null,
    })
    // draftCategoriesKey collapses the category array to a primitive dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftCategoriesKey, newProposal.facilityId, newProposal.facilityName])

  // Edit flow: hydrate the form from the saved proposal once its detail loads.
  // (The Deal Scorer / Opportunity data on the proposal is preserved server-side
  // by updateProposal — we only re-edit the builder fields here.)
  const hydratedRef = useRef<string | null>(null)
  useEffect(() => {
    // Gate on !isFetching: after a save + invalidation, React Query hands back
    // the STALE cached detail synchronously while refetching — hydrating from
    // it (and one-shot-locking via the ref) would re-edit outdated values and
    // clobber the prior save on submit (bug-bash V-C3).
    if (
      !editingProposalId ||
      !editDetail ||
      editDetailFetching ||
      hydratedRef.current === editingProposalId
    )
      return
    hydratedRef.current = editingProposalId
    setNewProposal((prev) => ({
      ...prev,
      proposalName: editDetail.name ?? "",
      facilityId: editDetail.facilities[0]?.id ?? "",
      facilityName: editDetail.facilities[0]?.name ?? "",
      isMultiFacility: editDetail.facilities.length > 1,
      facilities: editDetail.facilities.map((f) => ({ id: f.id, name: f.name })),
      productCategory: editDetail.productCategories?.[0] ?? "",
      productCategories: editDetail.productCategories ?? [],
      isGrouped: Boolean(editDetail.divisions && editDetail.divisions.length > 0),
      divisions: editDetail.divisions ?? [],
      contractLength: editDetail.contractLengthMonths ?? prev.contractLength,
      // Round-trip survival (bug-bash V-C4): keep the saved start date and
      // payment terms so re-saving doesn't silently rewrite/drop them.
      startDate: editDetail.startDate ?? prev.startDate,
      paymentTerms: editDetail.paymentTerms ?? prev.paymentTerms,
      projectedSpend: editDetail.projectedSpend ?? 0,
      projectedVolume: editDetail.projectedVolume ?? 0,
      marketShareCommitment: editDetail.marketShareCommitment ?? prev.marketShareCommitment,
      gpoFee: editDetail.gpoFee ?? prev.gpoFee,
      aiNotes: editDetail.aiNotes ?? "",
      products: (editDetail.pricingItems ?? []).map((it) => ({
        benchmarkId: "",
        productName: it.description ?? "",
        refNumber: it.vendorItemNo ?? undefined,
        proposedPrice: it.proposedPrice,
        currentPrice: it.currentPrice,
        projectedVolume: it.quantity ?? 0,
      })),
      terms: (editDetail.terms ?? []).map((t) => ({
        id: crypto.randomUUID(),
        termType: (t.termType as ProspectiveTerm["termType"]) ?? "spend_rebate",
        name: t.name ?? "",
        targetType: (t.targetType as ProspectiveTerm["targetType"]) ?? "spend",
        targetValue: t.targetValue ?? 0,
        rebatePercent: t.rebatePercent ?? 0,
        // Round-trip survival (Wave 1.C): rebateType + tiers used to be reset
        // here — a saved tier ladder vanished on every edit. Historic rows
        // (no rebateType) are percent; tier rows re-mint their UI-only _uid.
        rebateType: t.rebateType ?? "percent",
        tiers: (t.tiers ?? []).map((tier) => ({
          _uid: crypto.randomUUID(),
          min: tier.min ?? 0,
          max: tier.max,
          value: tier.value ?? 0,
        })),
      })),
    }))
  }, [editingProposalId, editDetail])

  const addTerm = () => {
    const newTerm: ProspectiveTerm = {
      id: crypto.randomUUID(),
      termType: "spend_rebate",
      name: "",
      targetType: "spend",
      targetValue: 0,
      rebatePercent: 0,
      rebateType: "percent",
      tiers: [],
    }
    setNewProposal(prev => ({ ...prev, terms: [...prev.terms, newTerm] }))
  }

  const removeTerm = (termId: string) => {
    setNewProposal(prev => ({ ...prev, terms: prev.terms.filter(t => t.id !== termId) }))
  }

  const updateTerm = (termId: string, updates: Partial<ProspectiveTerm>) => {
    setNewProposal(prev => ({
      ...prev,
      terms: prev.terms.map(t => t.id === termId ? { ...t, ...updates } : t),
    }))
  }

  const removeProductFromProposal = (benchmarkId: string) => {
    setNewProposal(prev => {
      const product = prev.products.find(p => p.benchmarkId === benchmarkId)
      return {
        ...prev,
        products: prev.products.filter(p => p.benchmarkId !== benchmarkId),
        // projectedSpend is a USER-OWNED assumption that uploads only
        // seed — removing a product must not silently mutate it (Vick:
        // "list ≠ entered value"). Volume stays derived.
        projectedVolume: prev.projectedVolume - (product?.projectedVolume || 0),
      }
    })
  }

  // Uploader improvements 1 (2026-06-13): both file inputs are now the
  // shared <PricingFileDropzone> (rendered in ProductsSection), which
  // owns file reading + the column-mapping/preview dialog. These
  // handlers receive the parsed rows + confirmed mapping and run the
  // unchanged downstream import (merge, aggregation, #66 category
  // auto-select, toasts). Errors are caught + toasted inside.
  const handlePricingImport = (
    rows: Record<string, string>[],
    mapping: ResolvedMapping,
    meta: { fileName: string; headers: string[] },
  ) =>
    handlePricingRowsImport(
      meta.headers,
      rows,
      mapping,
      setFileUploadProgress,
      setNewProposal,
      setCustomCategories,
    )

  const handleUsageImport = (
    rows: Record<string, string>[],
    mapping: ResolvedMapping,
    meta: { fileName: string; headers: string[] },
  ) =>
    handleUsageRowsImport(
      meta.headers,
      rows,
      mapping,
      setFileUploadProgress,
      setNewProposal,
    )

  const handleGenerateTermsFromNotes = useCallback(() => {
    // Synchronous keyword heuristics — no artificial "analyzing" delay.
    const suggestions = generateTermsFromNotes(newProposal, setNewProposal)
    setTermSuggestions({ data: suggestions })
  }, [newProposal])

  // Per-term rebate/savings estimate through the ONE tested module (Wave 1.C
  // — replaced the inline calculateEstimatedRebate that paid volume terms
  // spend×%, paid $0 for market_share/price_reduction, and ignored tiers).
  const termEstimate = useMemo(
    () =>
      estimateProposalTerms(
        newProposal.terms.map((t) => ({
          termType: t.termType,
          name: t.name,
          targetType: t.targetType,
          targetValue: t.targetValue,
          rebatePercent: t.rebatePercent,
          rebateType: t.rebateType,
          tiers: t.tiers.map(({ min, max, value }) => ({ min, max, value })),
        })),
        newProposal.projectedSpend,
        newProposal.projectedVolume,
      ),
    [newProposal.terms, newProposal.projectedSpend, newProposal.projectedVolume],
  )

  const resetForm = () => {
    setNewProposal({
      proposalName: "",
      facilityId: "",
      facilityName: "",
      isMultiFacility: false,
      facilities: [],
      productCategory: "",
      productCategories: [],
      isGrouped: false,
      groupName: "",
      contractLength: 24,
      projectedSpend: 0,
      projectedVolume: 0,
      totalOpportunity: 0,
      terms: [],
      products: [],
      marketShareCommitment: 50,
      gpoFee: 3,
      aiNotes: "",
    })
    createdIdRef.current = null
  }
  // Cancel: reset + let the parent navigate away.
  const handleResetAndClose = () => {
    resetForm()
    onClose?.()
  }

  // The row THIS builder session is bound to — subsequent saves UPDATE it
  // instead of minting a duplicate draft per click (bugs.rtfd 2026-07-07
  // explicit-save flow). It is deliberately NOT reset by any effect: the
  // one-page workspace remounts the builder with a fresh session key when the
  // vendor starts a new proposal (lib/prospective/builder-session.ts), so the
  // binding dies with the session that owns it.
  const createdIdRef = useRef<string | null>(null)

  // Core persist — validation + create/update. Returns the proposal (or null
  // on a validation miss). No navigation side-effects, so both the explicit
  // Save button AND the one-page "Analyze deal" bridge can call it.
  const persist = async (): Promise<VendorProposal | null> => {
    if (!newProposal.productCategory && newProposal.productCategories.length === 0) {
      toast.error("Please select at least one product category")
      return null
    }

    const facilityIds: string[] = []
    if (newProposal.facilityId) facilityIds.push(newProposal.facilityId)
    if (newProposal.isMultiFacility) {
      for (const f of newProposal.facilities) {
        if (!facilityIds.includes(f.id)) facilityIds.push(f.id)
      }
    }

    const pricingItems: ProposedPricingItem[] = newProposal.products
      .filter(p => p.proposedPrice > 0)
      .map(p => ({
        vendorItemNo: p.refNumber || p.benchmarkId,
        description: p.productName,
        proposedPrice: p.proposedPrice,
        currentPrice: p.currentPrice,
        costBasis: p.costBasis,
        quantity: p.projectedVolume || 1,
      }))

    if (pricingItems.length === 0) {
      toast.error("Please add at least one product with pricing")
      return null
    }

    try {
      // Shared builder payload — Charles 2026-04-26 #67: carry the rich fields
      // so the detail dialog renders what the builder collected.
      const payload = {
        name: newProposal.proposalName.trim() || undefined,
        facilityIds: facilityIds.length > 0 ? facilityIds : ["none"],
        pricingItems,
        terms: {
          contractLength: newProposal.contractLength,
          // Editing keeps the hydrated start date; only a NEW proposal
          // defaults to today (V-C4 — edit used to reset it).
          startDate:
            newProposal.startDate ?? new Date().toISOString().split("T")[0]!,
          paymentTerms: newProposal.paymentTerms,
          notes: newProposal.aiNotes || undefined,
        },
        productCategories:
          newProposal.productCategories.length > 0
            ? newProposal.productCategories
            : newProposal.productCategory
              ? [newProposal.productCategory]
              : undefined,
        // Grouped-proposal division labels were silently dropped on save.
        divisions:
          newProposal.divisions && newProposal.divisions.length > 0
            ? newProposal.divisions
            : undefined,
        projectedSpend: newProposal.projectedSpend || undefined,
        projectedVolume: newProposal.projectedVolume || undefined,
        marketShareCommitment: newProposal.marketShareCommitment || undefined,
        gpoFee: newProposal.gpoFee || undefined,
        aiNotes: newProposal.aiNotes || undefined,
        proposalTerms:
          newProposal.terms.length > 0
            ? newProposal.terms.map((t) => ({
                termType: t.termType,
                name: t.name,
                targetType: t.targetType,
                targetValue: t.targetValue,
                rebatePercent: t.rebatePercent,
                // Wave 1.C: rebateType + tiers used to be STRIPPED here, so a
                // built ladder never persisted. The UI-only _uid stays out of
                // the payload (persist boundary — CLAUDE.md list-key rule).
                rebateType: t.rebateType,
                tiers:
                  t.tiers.length > 0
                    ? t.tiers.map(({ min, max, value }) => ({ min, max, value }))
                    : undefined,
              }))
            : undefined,
      }
      // Edit an existing proposal in place (opened for edit OR already
      // created by a prior save in this session), or create a new draft.
      const target = resolveProposalPersistTarget(
        editingProposalId,
        createdIdRef.current,
      )
      const created =
        target.mode === "update"
          ? await updateMutation.mutateAsync({
              proposalId: target.proposalId,
              ...payload,
            })
          : await createMutation.mutateAsync({
              vendorId,
              ...payload,
              vendorDivisionId: showDivisionPicker
                ? vendorDivisionId || (myDivisions?.divisions[0]?.id ?? null)
                : null,
            })
      // Bind unconditionally (Charles 2026-07-27). The old `if
      // (!editingProposalId)` guard meant an edit session left the ref null
      // and the bound row lived in two places at once — with the session key
      // now owning the reset, one place is enough and the two can't drift.
      createdIdRef.current = created.id
      return created
    } catch {
      // Error toast handled by mutation
      return null
    }
  }

  // Explicit Save button (non-embedded flow): persist, then reset + hand off.
  const submitProposal = async () => {
    const created = await persist()
    if (!created) return
    resetForm()
    onProposalCreated?.(created)
  }

  // Imperative save for the one-page flow — the Deal Scorer's "Analyze deal"
  // calls this so there is no separate mid-page Save button (Charles
  // 2026-07-06 "it says to save the deal before the end"). Keeps the form
  // intact (no reset) and attaches the proposal without collapsing.
  useImperativeHandle(ref, () => ({
    submit: async () => {
      const created = await persist()
      if (created) onAutoAttach?.(created)
      return created
    },
    hasContent: () =>
      newProposal.products.length > 0 ||
      newProposal.productCategories.length > 0 ||
      Boolean(newProposal.facilityId),
  }))

  return (
    <div className="space-y-6">
      <ProposalHeader editingProposalId={editingProposalId} />

      <div className="space-y-6">
        <div className="space-y-1.5">
          <Label htmlFor="proposal-name">Proposal name</Label>
          <Input
            id="proposal-name"
            className="max-w-md"
            placeholder="e.g. Lighthouse TJA 2026 renewal"
            value={newProposal.proposalName}
            onChange={(e) =>
              setNewProposal((prev) => ({
                ...prev,
                proposalName: e.target.value,
              }))
            }
          />
          <p className="text-xs text-muted-foreground">
            Saved with the proposal and shown in your proposal lists. Left
            blank, a name is generated from the item count.
          </p>
        </div>

        <FacilitySelector
          newProposal={newProposal}
          setNewProposal={setNewProposal}
          allFacilities={allFacilities}
          allCategories={allCategories}
          showAddFacility={showAddFacility}
          setShowAddFacility={setShowAddFacility}
          newFacilityName={newFacilityName}
          setNewFacilityName={setNewFacilityName}
          showAddCategory={showAddCategory}
          setShowAddCategory={setShowAddCategory}
          newCategoryName={newCategoryName}
          setNewCategoryName={setNewCategoryName}
          setCustomFacilities={setCustomFacilities}
          setCustomCategories={setCustomCategories}
        />

        {showDivisionPicker ? (
          <div className="space-y-1.5">
            <Label htmlFor="proposal-division">Division</Label>
            <Select
              value={vendorDivisionId || (myDivisions?.divisions[0]?.id ?? "")}
              onValueChange={setVendorDivisionId}
            >
              <SelectTrigger id="proposal-division" className="w-[280px]">
                <SelectValue placeholder="Select a division" />
              </SelectTrigger>
              <SelectContent>
                {(myDivisions?.divisions ?? []).map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              You belong to several divisions — the proposal is visible only
              inside the one you pick.
            </p>
          </div>
        ) : null}

        <ContractParameters
          newProposal={newProposal}
          setNewProposal={setNewProposal}
        />

        <Separator />

        <DealNotes
          newProposal={newProposal}
          setNewProposal={setNewProposal}
          termSuggestions={termSuggestions}
          onGenerateTermsFromNotes={handleGenerateTermsFromNotes}
        />

        <Separator />

        <ProductsSection
          newProposal={newProposal}
          fileUploadProgress={fileUploadProgress}
          onUsageImport={handleUsageImport}
          onPricingImport={handlePricingImport}
          removeProductFromProposal={removeProductFromProposal}
        />

        <Separator />

        <ContractTerms
          newProposal={newProposal}
          addTerm={addTerm}
          removeTerm={removeTerm}
          updateTerm={updateTerm}
          estimate={termEstimate}
        />

        {score && <DealScoreView score={score} />}

        {embedded ? (
          // One-page flow: "Analyze deal" below still saves + scores in one
          // action, but the vendor can ALSO save the work-in-progress
          // explicitly ("There is no where to save a proposal you are working
          // on", bugs.rtfd 2026-07-07). Save keeps the form open — it just
          // persists and attaches the proposal below.
          <div className="flex flex-wrap items-center justify-end gap-3">
            <p className="text-xs text-muted-foreground">
              <strong>Analyze deal</strong> below saves and scores in one step
              — or save your progress now.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={createMutation.isPending || updateMutation.isPending}
              onClick={async () => {
                const created = await persist()
                if (!created) return
                onAutoAttach?.(created)
                toast.success(
                  created.name
                    ? `Proposal "${created.name}" saved`
                    : "Proposal saved",
                )
              }}
            >
              <Save className="mr-1.5 h-4 w-4" />
              Save proposal
            </Button>
          </div>
        ) : (
          <ProposalActions
            editingProposalId={editingProposalId}
            isPending={createMutation.isPending || updateMutation.isPending}
            onCancel={handleResetAndClose}
            onSubmit={submitProposal}
          />
        )}
      </div>
    </div>
  )
})
