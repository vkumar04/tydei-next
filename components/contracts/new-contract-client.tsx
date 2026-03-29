"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { ArrowLeft, ArrowRight, Loader2, Sparkles, Save, FileText } from "lucide-react"
import { useContractForm } from "@/hooks/use-contract-form"
import { useCreateContract } from "@/hooks/use-contracts"
import { createContractTerm } from "@/lib/actions/contract-terms"
import { ContractFormBasicInfo } from "@/components/contracts/contract-form"
import { ContractTermsEntry } from "@/components/contracts/contract-terms-entry"
import { ContractFormReview } from "@/components/contracts/contract-form-review"
import { AIExtractDialog } from "@/components/contracts/ai-extract-dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import type { ExtractedContractData } from "@/lib/ai/schemas"

interface NewContractClientProps {
  vendors: { id: string; name: string; displayName: string | null }[]
  categories: { id: string; name: string }[]
}

export function NewContractClient({
  vendors,
  categories,
}: NewContractClientProps) {
  const router = useRouter()
  const [aiExtractOpen, setAiExtractOpen] = useState(false)
  const {
    form,
    step,
    terms,
    setTerms,
    nextStep,
    prevStep,
    goToStep,
    isFirstStep,
    isLastStep,
  } = useContractForm()
  const createMutation = useCreateContract()

  function handleAIExtract(data: ExtractedContractData) {
    form.setValue("name", data.contractName)
    form.setValue("contractType", data.contractType)
    form.setValue("effectiveDate", data.effectiveDate)
    form.setValue("expirationDate", data.expirationDate)
    if (data.totalValue) form.setValue("totalValue", data.totalValue)
    if (data.description) form.setValue("description", data.description)

    // Try to match vendor by name
    const matchedVendor = vendors.find(
      (v) =>
        v.name.toLowerCase().includes(data.vendorName.toLowerCase()) ||
        (v.displayName ?? "").toLowerCase().includes(data.vendorName.toLowerCase())
    )
    if (matchedVendor) form.setValue("vendorId", matchedVendor.id)

    // Populate terms if extracted
    if (data.terms.length > 0) {
      setTerms(
        data.terms.map((t) => ({
          termName: t.termName,
          termType: "spend_rebate" as const,
          baselineType: "spend_based" as const,
          evaluationPeriod: "annual",
          paymentTiming: "quarterly",
          appliesTo: "all_products",
          effectiveStart: data.effectiveDate,
          effectiveEnd: data.expirationDate,
          tiers: t.tiers.map((tier) => ({
            tierNumber: tier.tierNumber,
            spendMin: tier.spendMin ?? 0,
            spendMax: tier.spendMax,
            rebateType: "percent_of_spend" as const,
            rebateValue: tier.rebateValue ?? 0,
          })),
        }))
      )
    }

    toast.success("Contract data extracted and populated")
  }

  async function handleSubmit() {
    const isValid = await form.trigger()
    if (!isValid) {
      goToStep("basic")
      toast.error("Please fix the form errors")
      return
    }

    const values = form.getValues()
    const contract = await createMutation.mutateAsync(values)

    // Create terms for the new contract
    for (const term of terms) {
      await createContractTerm({
        ...term,
        contractId: contract.id,
      })
    }

    router.push(`/dashboard/contracts/${contract.id}`)
  }

  async function handleSaveAsDraft() {
    // Set status to draft regardless of validation
    form.setValue("status", "draft")

    const values = form.getValues()
    // Only require a name for draft
    if (!values.name) {
      toast.error("Please enter a contract name")
      return
    }

    const contract = await createMutation.mutateAsync(values)

    // Create terms for the new contract
    for (const term of terms) {
      await createContractTerm({
        ...term,
        contractId: contract.id,
      })
    }

    router.push(`/dashboard/contracts/${contract.id}`)
  }

  async function handleNext() {
    if (step === "basic") {
      const isValid = await form.trigger()
      if (!isValid) return
    }
    nextStep()
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Page Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/dashboard/contracts">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight">New Contract</h1>
          <p className="text-muted-foreground">Create a new vendor contract</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setAiExtractOpen(true)}>
            <Sparkles className="mr-2 h-4 w-4" /> AI Extract
          </Button>
        </div>
      </div>

      <AIExtractDialog
        open={aiExtractOpen}
        onOpenChange={setAiExtractOpen}
        onExtracted={handleAIExtract}
      />

      <Tabs value={step} onValueChange={(v) => goToStep(v as typeof step)}>
        <TabsList>
          <TabsTrigger value="basic" className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Basic Info
          </TabsTrigger>
          <TabsTrigger value="terms">Terms & Tiers</TabsTrigger>
          <TabsTrigger value="review">Review</TabsTrigger>
        </TabsList>

        <TabsContent value="basic" className="mt-6">
          <ContractFormBasicInfo
            form={form}
            vendors={vendors}
            categories={categories}
          />
        </TabsContent>

        <TabsContent value="terms" className="mt-6">
          <ContractTermsEntry terms={terms} onChange={setTerms} />
        </TabsContent>

        <TabsContent value="review" className="mt-6">
          <ContractFormReview
            values={form.getValues()}
            terms={terms}
            vendors={vendors}
            categories={categories}
          />
        </TabsContent>
      </Tabs>

      <div className="flex items-center justify-between border-t pt-4">
        <Button
          variant="outline"
          onClick={prevStep}
          disabled={isFirstStep}
        >
          <ArrowLeft className="mr-2 h-4 w-4" /> Previous
        </Button>

        <div className="flex items-center gap-2">
          {isLastStep ? (
            <>
              <Button
                variant="outline"
                onClick={handleSaveAsDraft}
                disabled={createMutation.isPending}
              >
                <Save className="mr-2 h-4 w-4" />
                Save as Draft
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={createMutation.isPending}
              >
                {createMutation.isPending && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Create Contract
              </Button>
            </>
          ) : (
            <Button onClick={handleNext}>
              Next <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
