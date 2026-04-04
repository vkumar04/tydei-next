"use client"

import { useState, useRef, useCallback } from "react"
import { Separator } from "@/components/ui/separator"
import { toast } from "sonner"
import { useCreateProposal } from "@/hooks/use-prospective"
import type { ProposedPricingItem } from "@/lib/actions/prospective"
import { DealScoreView } from "./deal-score-view"
import type { DealScore } from "@/lib/actions/prospective"

import { ProposalHeader } from "./builder/proposal-header"
import { FacilitySelector } from "./builder/facility-selector"
import { ContractParameters } from "./builder/contract-parameters"
import { AiDealNotes } from "./builder/ai-deal-notes"
import { ProductsSection } from "./builder/products-section"
import { ContractTerms } from "./builder/contract-terms"
import { ProposalActions } from "./builder/proposal-actions"
import {
  handlePricingFileUpload as doPricingUpload,
  handleUsageFileUpload as doUsageUpload,
  generateProductsFromAI as doGenerateAI,
  generateTermsFromNotes,
} from "./builder/file-handlers"
import type {
  NewProposalState,
  ProspectiveFacility,
  ProspectiveTerm,
  AiSuggestionsState,
  FileUploadProgressState,
} from "./builder/types"
import { PRODUCT_CATEGORIES } from "./builder/types"

interface ProposalBuilderProps {
  vendorId: string
  facilities: { id: string; name: string }[]
  editingProposalId?: string | null
  onClose?: () => void
}

export function ProposalBuilder({ vendorId, facilities, editingProposalId, onClose }: ProposalBuilderProps) {
  const createMutation = useCreateProposal()
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

  const [isGeneratingAI, setIsGeneratingAI] = useState(false)
  const [aiProductDescription, setAiProductDescription] = useState("")

  const [aiSuggestions, setAiSuggestions] = useState<AiSuggestionsState>({
    isLoading: false, data: null,
  })

  const lastAnalyzedRef = useRef<string>("")

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
        projectedSpend: prev.projectedSpend - (product ? product.proposedPrice * product.projectedVolume : 0),
        projectedVolume: prev.projectedVolume - (product?.projectedVolume || 0),
      }
    })
  }

  const handlePricingFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    doPricingUpload(e, setFileUploadProgress, setNewProposal)
  }

  const handleUsageFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    doUsageUpload(e, setFileUploadProgress, setNewProposal)
  }

  const generateProductsFromAI = useCallback(async () => {
    await doGenerateAI(
      aiProductDescription,
      newProposal.productCategory,
      setIsGeneratingAI,
      setNewProposal,
      setAiProductDescription,
    )
  }, [aiProductDescription, newProposal.productCategory])

  const handleGenerateTermsFromNotes = useCallback(() => {
    setAiSuggestions({ isLoading: true, data: null })
    // Small delay to show loading state, then generate
    setTimeout(() => {
      const suggestions = generateTermsFromNotes(newProposal, setNewProposal)
      setAiSuggestions({ isLoading: false, data: suggestions })
    }, 600)
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

  const handleResetAndClose = () => {
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
    setAiProductDescription("")
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
        quantity: p.projectedVolume || 1,
      }))

    if (pricingItems.length === 0) {
      toast.error("Please add at least one product with pricing")
      return
    }

    try {
      await createMutation.mutateAsync({
        vendorId,
        facilityIds: facilityIds.length > 0 ? facilityIds : ["none"],
        pricingItems,
        terms: {
          contractLength: newProposal.contractLength,
          startDate: new Date().toISOString().split("T")[0],
          notes: newProposal.aiNotes || undefined,
        },
      })
      handleResetAndClose()
    } catch {
      // Error toast handled by mutation
    }
  }

  const analyzeTheDeal = useCallback(async () => {
    toast.error("AI features require Vercel billing setup. Add a credit card to enable AI analysis.")
  }, [])

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

        <ContractParameters
          newProposal={newProposal}
          setNewProposal={setNewProposal}
        />

        <Separator />

        <AiDealNotes
          newProposal={newProposal}
          setNewProposal={setNewProposal}
          aiSuggestions={aiSuggestions}
          lastAnalyzedRef={lastAnalyzedRef}
          analyzeTheDeal={analyzeTheDeal}
          onGenerateTermsFromNotes={handleGenerateTermsFromNotes}
        />

        <Separator />

        <ProductsSection
          newProposal={newProposal}
          fileUploadProgress={fileUploadProgress}
          aiProductDescription={aiProductDescription}
          setAiProductDescription={setAiProductDescription}
          isGeneratingAI={isGeneratingAI}
          handleUsageFileUpload={handleUsageFileUpload}
          handlePricingFileUpload={handlePricingFileUpload}
          generateProductsFromAI={generateProductsFromAI}
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
          isPending={createMutation.isPending}
          onCancel={handleResetAndClose}
          onSubmit={submitProposal}
        />
      </div>
    </div>
  )
}
