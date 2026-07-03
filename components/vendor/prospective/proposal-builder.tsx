"use client"

import { useEffect, useRef, useState, useCallback } from "react"
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
  parseProductsFromDescription as doParseProducts,
  generateTermsFromNotes,
} from "./builder/file-handlers"
import type { ResolvedMapping } from "@/components/shared/uploads/field-spec"
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
  /** Called after a proposal is saved, with the created row — lets the parent
   *  continue into the Deal Scorer pre-loaded ("save → next step"). */
  onProposalCreated?: (proposal: VendorProposal) => void
}

export function ProposalBuilder({ vendorId, facilities, editingProposalId, onClose, onProposalCreated }: ProposalBuilderProps) {
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

  const [productDescription, setProductDescription] = useState("")

  const [termSuggestions, setTermSuggestions] = useState<TermSuggestionsState>({
    data: null,
  })

  const [newProposal, setNewProposal] = useState<NewProposalState>({
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
        tiers: [],
      })),
    }))
  }, [editingProposalId, editDetail])

  const addTerm = () => {
    const newTerm: ProspectiveTerm = {
      id: `term-${Date.now()}`,
      termType: "spend_rebate",
      name: "",
      targetType: "spend",
      targetValue: 0,
      rebatePercent: 0,
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

  const parseProductsFromDescription = useCallback(() => {
    doParseProducts(
      productDescription,
      newProposal.productCategory,
      setNewProposal,
      setProductDescription,
    )
  }, [productDescription, newProposal.productCategory])

  const handleGenerateTermsFromNotes = useCallback(() => {
    // Synchronous keyword heuristics — no artificial "analyzing" delay.
    const suggestions = generateTermsFromNotes(newProposal, setNewProposal)
    setTermSuggestions({ data: suggestions })
  }, [newProposal])

  const calculateEstimatedRebate = () => {
    let total = 0
    newProposal.terms.forEach(term => {
      if (term.termType === "spend_rebate" && newProposal.projectedSpend >= term.targetValue) {
        total += newProposal.projectedSpend * (term.rebatePercent / 100)
      } else if (term.termType === "volume_rebate" && newProposal.projectedVolume >= term.targetValue) {
        total += newProposal.projectedSpend * (term.rebatePercent / 100)
      }
    })
    return total
  }

  const resetForm = () => {
    setNewProposal({
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
    setProductDescription("")
  }
  // Cancel: reset + let the parent navigate away.
  const handleResetAndClose = () => {
    resetForm()
    onClose?.()
  }

  const submitProposal = async () => {
    if (!newProposal.facilityId && !newProposal.isMultiFacility) {
      // Allow submission without facility selection (manual entry)
    }

    if (!newProposal.productCategory && newProposal.productCategories.length === 0) {
      toast.error("Please select at least one product category")
      return
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
      return
    }

    try {
      // Shared builder payload — Charles 2026-04-26 #67: carry the rich fields
      // so the detail dialog renders what the builder collected.
      const payload = {
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
              }))
            : undefined,
      }
      // Edit an existing proposal in place, or create a new draft.
      const created = editingProposalId
        ? await updateMutation.mutateAsync({ proposalId: editingProposalId, ...payload })
        : await createMutation.mutateAsync({
            vendorId,
            ...payload,
            vendorDivisionId: showDivisionPicker
              ? vendorDivisionId || (myDivisions?.divisions[0]?.id ?? null)
              : null,
          })
      // Continue into the Deal Scorer pre-loaded with this proposal ("save →
      // next step"). onProposalCreated owns navigation; only reset the form
      // here (calling handleResetAndClose would fire onClose and override it).
      resetForm()
      onProposalCreated?.(created)
    } catch {
      // Error toast handled by mutation
    }
  }

  return (
    <div className="space-y-6">
      <ProposalHeader editingProposalId={editingProposalId} />

      <div className="space-y-6">
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
          productDescription={productDescription}
          setProductDescription={setProductDescription}
          onUsageImport={handleUsageImport}
          onPricingImport={handlePricingImport}
          parseProductsFromDescription={parseProductsFromDescription}
          removeProductFromProposal={removeProductFromProposal}
        />

        <Separator />

        <ContractTerms
          newProposal={newProposal}
          addTerm={addTerm}
          removeTerm={removeTerm}
          updateTerm={updateTerm}
          estimatedRebate={calculateEstimatedRebate()}
        />

        {score && <DealScoreView score={score} />}

        <ProposalActions
          editingProposalId={editingProposalId}
          isPending={createMutation.isPending || updateMutation.isPending}
          onCancel={handleResetAndClose}
          onSubmit={submitProposal}
        />
      </div>
    </div>
  )
}
