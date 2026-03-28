"use client"

import { useRouter } from "next/navigation"
import { ArrowLeft, ArrowRight, Loader2 } from "lucide-react"
import { useContractForm } from "@/hooks/use-contract-form"
import { useCreateContract } from "@/hooks/use-contracts"
import { createContractTerm } from "@/lib/actions/contract-terms"
import { PageHeader } from "@/components/shared/page-header"
import { ContractFormBasicInfo } from "@/components/contracts/contract-form"
import { ContractTermsEntry } from "@/components/contracts/contract-terms-entry"
import { ContractFormReview } from "@/components/contracts/contract-form-review"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"

interface NewContractClientProps {
  vendors: { id: string; name: string; displayName: string | null }[]
  categories: { id: string; name: string }[]
}

export function NewContractClient({
  vendors,
  categories,
}: NewContractClientProps) {
  const router = useRouter()
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
          <Button variant="outline" onClick={() => router.back()}>
            Cancel
          </Button>
        }
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
