"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft, ArrowRight, Loader2, Sparkles } from "lucide-react"
import { useContractForm } from "@/hooks/use-contract-form"
import { useCreateContract } from "@/hooks/use-contracts"
import { createContractTerm } from "@/lib/actions/contract-terms"
import { PageHeader } from "@/components/shared/page-header"
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

  async function handleNext() {
    if (step === "basic") {
      const isValid = await form.trigger()
      if (!isValid) return
    }
    nextStep()
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="New Contract"
        description="Create a new vendor contract"
        action={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setAiExtractOpen(true)}>
              <Sparkles className="size-4" /> AI Extract
            </Button>
            <Button variant="outline" onClick={() => router.back()}>
              Cancel
            </Button>
          </div>
        }
      />

      <AIExtractDialog
        open={aiExtractOpen}
        onOpenChange={setAiExtractOpen}
        onExtracted={handleAIExtract}
      />

      <Tabs value={step} onValueChange={(v) => goToStep(v as typeof step)}>
        <TabsList>
          <TabsTrigger value="basic">Basic Info</TabsTrigger>
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
          <ArrowLeft className="size-4" /> Previous
        </Button>

        {isLastStep ? (
          <Button
            onClick={handleSubmit}
            disabled={createMutation.isPending}
          >
            {createMutation.isPending && (
              <Loader2 className="animate-spin" />
            )}
            Create Contract
          </Button>
        ) : (
          <Button onClick={handleNext}>
            Next <ArrowRight className="size-4" />
          </Button>
        )}
      </div>
    </div>
  )
}
