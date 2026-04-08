"use client"

import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import Link from "next/link"
import { ArrowLeft, Loader2, Save, X } from "lucide-react"
import { useContract, useUpdateContract } from "@/hooks/use-contracts"
import { useContractForm } from "@/hooks/use-contract-form"
import { upsertContractTiers, createContractTerm, deleteContractTerm } from "@/lib/actions/contract-terms"
import { ContractFormBasicInfo } from "@/components/contracts/contract-form"
import { ContractTermsEntry } from "@/components/contracts/contract-terms-entry"
import { ContractDocumentsList } from "@/components/contracts/contract-documents-list"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { toast } from "sonner"

interface EditContractClientProps {
  contractId: string
  vendors: { id: string; name: string; displayName: string | null }[]
  categories: { id: string; name: string }[]
}

export function EditContractClient({
  contractId,
  vendors,
  categories,
}: EditContractClientProps) {
  const router = useRouter()
  const { data: contract, isLoading } = useContract(contractId)
  const updateMutation = useUpdateContract()
  const [initialized, setInitialized] = useState(false)

  const { form, terms, setTerms } = useContractForm()

  // Initialize form when contract data loads
  useEffect(() => {
    if (contract && !initialized) {
      form.reset({
        name: contract.name,
        contractNumber: contract.contractNumber ?? "",
        vendorId: contract.vendorId,
        facilityId: contract.facilityId ?? undefined,
        productCategoryId: contract.productCategoryId ?? undefined,
        contractType: contract.contractType,
        status: contract.status,
        effectiveDate: new Date(contract.effectiveDate).toISOString().split("T")[0],
        expirationDate: new Date(contract.expirationDate).toISOString().split("T")[0],
        autoRenewal: contract.autoRenewal,
        terminationNoticeDays: contract.terminationNoticeDays,
        totalValue: Number(contract.totalValue),
        annualValue: Number(contract.annualValue),
        description: contract.description ?? "",
        notes: contract.notes ?? "",
        gpoAffiliation: contract.gpoAffiliation ?? "",
        performancePeriod: contract.performancePeriod,
        rebatePayPeriod: contract.rebatePayPeriod,
        isMultiFacility: contract.isMultiFacility,
        facilityIds: contract.contractFacilities.map((cf) => cf.facilityId),
        categoryIds: contract.contractCategories?.map((cc: { productCategoryId: string }) => cc.productCategoryId) ?? (contract.productCategoryId ? [contract.productCategoryId] : []),
      })

      setTerms(
        contract.terms.map((t) => ({
          id: t.id,
          termName: t.termName,
          termType: t.termType,
          baselineType: t.baselineType,
          evaluationPeriod: t.evaluationPeriod,
          paymentTiming: t.paymentTiming,
          appliesTo: t.appliesTo,
          effectiveStart: new Date(t.effectiveStart).toISOString().split("T")[0],
          effectiveEnd: new Date(t.effectiveEnd).toISOString().split("T")[0],
          spendBaseline: t.spendBaseline ? Number(t.spendBaseline) : undefined,
          volumeBaseline: t.volumeBaseline ?? undefined,
          growthBaselinePercent: t.growthBaselinePercent ? Number(t.growthBaselinePercent) : undefined,
          desiredMarketShare: t.desiredMarketShare ? Number(t.desiredMarketShare) : undefined,
          tiers: t.tiers.map((tier) => ({
            id: tier.id,
            tierNumber: tier.tierNumber,
            spendMin: Number(tier.spendMin),
            spendMax: tier.spendMax ? Number(tier.spendMax) : undefined,
            volumeMin: tier.volumeMin ?? undefined,
            volumeMax: tier.volumeMax ?? undefined,
            marketShareMin: tier.marketShareMin ? Number(tier.marketShareMin) : undefined,
            marketShareMax: tier.marketShareMax ? Number(tier.marketShareMax) : undefined,
            rebateType: tier.rebateType,
            rebateValue: Number(tier.rebateValue),
          })),
        }))
      )

      setInitialized(true)
    }
  }, [contract, initialized, form, setTerms])

  async function handleSave() {
    const isValid = await form.trigger()
    if (!isValid) {
      toast.error("Please fix the form errors")
      return
    }

    const values = form.getValues()
    await updateMutation.mutateAsync({ id: contractId, data: values })

    // Sync terms: delete removed, create new, update existing tiers
    if (contract) {
      const existingIds = contract.terms.map((t) => t.id)
      const currentIds = terms.filter((t) => t.id).map((t) => t.id as string)

      // Delete removed terms
      for (const existingId of existingIds) {
        if (!currentIds.includes(existingId)) {
          await deleteContractTerm(existingId)
        }
      }

      // Create new terms and update tiers of existing
      for (const term of terms) {
        if (term.id) {
          await upsertContractTiers(term.id, term.tiers)
        } else {
          await createContractTerm({
            ...term,
            contractId,
          })
        }
      }
    }

    router.push(`/dashboard/contracts/${contractId}`)
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-[400px] w-full" />
      </div>
    )
  }

  if (!contract) return null

  return (
    <div className="flex flex-col gap-6">
      {/* Page Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href={`/dashboard/contracts/${contractId}`}>
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight">Edit Contract</h1>
          <p className="text-muted-foreground">{contract.name}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link href={`/dashboard/contracts/${contractId}`}>
              <X className="mr-2 h-4 w-4" />
              Cancel
            </Link>
          </Button>
          <Button onClick={handleSave} disabled={updateMutation.isPending}>
            {updateMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            {updateMutation.isPending ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </div>

      <Tabs defaultValue="basic">
        <TabsList>
          <TabsTrigger value="basic">Contract Details</TabsTrigger>
          <TabsTrigger value="terms">
            Terms & Rebates
            {terms.length > 0 && (
              <Badge variant="secondary" className="ml-2">{terms.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
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

        <TabsContent value="documents" className="mt-6">
          <ContractDocumentsList documents={contract.documents} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
