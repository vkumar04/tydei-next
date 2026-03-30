"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import {
  ArrowLeft,
  Loader2,
  Sparkles,
  Save,
  FileText,
  Upload,
} from "lucide-react"
import { useContractForm } from "@/hooks/use-contract-form"
import { useCreateContract } from "@/hooks/use-contracts"
import { createContractTerm } from "@/lib/actions/contract-terms"
import { ContractFormBasicInfo } from "@/components/contracts/contract-form"
import { ContractTermsEntry } from "@/components/contracts/contract-terms-entry"
import { ContractFormReview } from "@/components/contracts/contract-form-review"
import { AIExtractDialog } from "@/components/contracts/ai-extract-dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
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
  const [entryMode, setEntryMode] = useState<"ai" | "manual" | "pdf">("manual")
  const [aiExtractOpen, setAiExtractOpen] = useState(false)
  const {
    form,
    terms,
    setTerms,
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
        (v.displayName ?? "")
          .toLowerCase()
          .includes(data.vendorName.toLowerCase())
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
    setEntryMode("manual")
  }

  async function handleSubmit() {
    const isValid = await form.trigger()
    if (!isValid) {
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

  return (
    <div className="flex flex-col gap-6">
      {/* Page header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/dashboard/contracts">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">New Contract</h1>
          <p className="text-muted-foreground">
            Create a new vendor contract
          </p>
        </div>
      </div>

      <AIExtractDialog
        open={aiExtractOpen}
        onOpenChange={setAiExtractOpen}
        onExtracted={handleAIExtract}
      />

      {/* Entry Mode Tabs */}
      <Tabs
        value={entryMode}
        onValueChange={(v) => setEntryMode(v as "ai" | "manual" | "pdf")}
        className="mb-2"
      >
        <TabsList className="grid w-full max-w-lg grid-cols-3">
          <TabsTrigger value="ai" className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" />
            AI Extract
          </TabsTrigger>
          <TabsTrigger value="pdf" className="flex items-center gap-2">
            <Upload className="h-4 w-4" />
            PDF Upload
          </TabsTrigger>
          <TabsTrigger value="manual" className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Manual Entry
          </TabsTrigger>
        </TabsList>

        {/* AI Extract Tab */}
        <TabsContent value="ai" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5" />
                AI Contract Extraction
              </CardTitle>
              <CardDescription>
                Upload a contract PDF and AI will extract the key fields
                automatically
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col items-center gap-4 py-8">
              <p className="text-sm text-muted-foreground">
                Upload a contract document and AI will extract all the relevant
                details.
              </p>
              <Button onClick={() => setAiExtractOpen(true)}>
                <Sparkles className="mr-2 h-4 w-4" />
                Start AI Extraction
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* PDF Upload Tab */}
        <TabsContent value="pdf" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Upload className="h-5 w-5" />
                Upload Contract PDF
              </CardTitle>
              <CardDescription>
                Upload a PDF document to auto-fill the contract form
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col items-center gap-4 py-8">
              <p className="text-sm text-muted-foreground">
                Upload a contract PDF to extract and populate all contract
                fields.
              </p>
              <Button onClick={() => setAiExtractOpen(true)}>
                <Upload className="mr-2 h-4 w-4" />
                Upload Contract PDF
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Manual Entry Tab */}
        <TabsContent value="manual" className="mt-4">
          <p className="text-sm text-muted-foreground mb-4">
            Fill in the contract details manually using the form below.
          </p>

          <div className="grid gap-6 lg:grid-cols-3">
            {/* Main form - 2 columns */}
            <div className="lg:col-span-2 space-y-6">
              <ContractFormBasicInfo
                form={form}
                vendors={vendors}
                categories={categories}
              />

              {/* Contract Terms */}
              {form.watch("contractType") !== "pricing_only" && (
                <Card>
                  <CardHeader>
                    <CardTitle>Contract Terms</CardTitle>
                    <CardDescription>
                      Define rebate tiers, pricing terms, market share
                      commitments, and other contract conditions
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ContractTermsEntry terms={terms} onChange={setTerms} />
                  </CardContent>
                </Card>
              )}
            </div>

            {/* Sidebar */}
            <div className="space-y-6">
              {/* Actions */}
              <Card>
                <CardContent className="p-4">
                  <div className="flex flex-col gap-2">
                    <Button
                      onClick={handleSubmit}
                      disabled={createMutation.isPending}
                      className="w-full"
                    >
                      {createMutation.isPending ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Save className="mr-2 h-4 w-4" />
                      )}
                      {createMutation.isPending
                        ? "Creating..."
                        : "Create Contract"}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={handleSaveAsDraft}
                      disabled={createMutation.isPending}
                      className="w-full"
                    >
                      Save as Draft
                    </Button>
                    <Button variant="outline" asChild className="w-full">
                      <Link href="/dashboard/contracts">Cancel</Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {/* Review Summary */}
              <ContractFormReview
                values={form.getValues()}
                terms={terms}
                vendors={vendors}
                categories={categories}
              />

              {/* Help */}
              <Card className="bg-muted/50">
                <CardContent className="p-4">
                  <h4 className="font-medium mb-2">Need help?</h4>
                  <p className="text-sm text-muted-foreground">
                    After creating the contract, you can add terms with specific
                    rebate structures, tiers, and product pricing.
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
