"use client"

import { useRouter } from "next/navigation"
import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { ArrowLeft, Loader2, Save, X } from "lucide-react"
import { useContract, useUpdateContract } from "@/hooks/use-contracts"
import { useContractForm } from "@/hooks/use-contract-form"
import { upsertContractTiers, createContractTerm, deleteContractTerm, updateContractTerm } from "@/lib/actions/contract-terms"
import { createCategory, getCategories } from "@/lib/actions/categories"
import { deriveContractTotalFromCOG } from "@/lib/actions/contracts/derive-from-cog"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import { ContractFormBasicInfo } from "@/components/contracts/contract-form"
import { ContractTermsEntry } from "@/components/contracts/contract-terms-entry"
import {
  ContractCapitalEntry,
  type ContractCapital,
} from "@/components/contracts/contract-capital-entry"
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
  const queryClient = useQueryClient()
  const { data: contract, isLoading } = useContract(contractId)
  const updateMutation = useUpdateContract()
  const [initialized, setInitialized] = useState(false)
  const { data: liveCategories } = useQuery({
    queryKey: queryKeys.categories.all,
    queryFn: () => getCategories(),
    initialData: categories,
  })

  const { form, terms, setTerms } = useContractForm()

  // Charles W1.T — contract-level tie-in capital state. Lifted out of
  // per-term state so all rebate terms pay down one balance.
  const [capital, setCapital] = useState<ContractCapital>({
    capitalCost: null,
    interestRate: null,
    termMonths: null,
    downPayment: null,
    paymentCadence: null,
    amortizationShape: "symmetrical",
  })

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

      // Charles W1.T — seed capital state from the Contract row.
      setCapital({
        capitalCost:
          contract.capitalCost != null ? Number(contract.capitalCost) : null,
        interestRate:
          contract.interestRate != null
            ? Number(contract.interestRate)
            : null,
        termMonths: contract.termMonths ?? null,
        downPayment:
          contract.downPayment != null ? Number(contract.downPayment) : null,
        paymentCadence:
          (contract.paymentCadence as ContractCapital["paymentCadence"]) ??
          null,
        amortizationShape:
          (contract.amortizationShape as ContractCapital["amortizationShape"]) ??
          "symmetrical",
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
          rebateMethod: t.rebateMethod ?? "cumulative",
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

  // Charles W1.W-A3a: auto-run "Suggest from COG" when the vendor
  // changes on an existing contract AND totalValue/annualValue are
  // still empty. Initialization above seeds both from the stored
  // contract, so this only fires on a deliberate vendor-change flow
  // where the user has first zeroed out the value fields.
  const watchedVendorId = form.watch("vendorId")
  const watchedEffective = form.watch("effectiveDate")
  const watchedExpiration = form.watch("expirationDate")
  const lastDerivedVendorRef = useRef<string | null>(null)
  useEffect(() => {
    if (!initialized || !watchedVendorId) return
    const currentTotal = form.getValues("totalValue") ?? 0
    const currentAnnual = form.getValues("annualValue") ?? 0
    if (currentTotal !== 0 && currentAnnual !== 0) return
    if (lastDerivedVendorRef.current === watchedVendorId && currentTotal !== 0) return
    lastDerivedVendorRef.current = watchedVendorId
    let cancelled = false
    ;(async () => {
      try {
        const r = await deriveContractTotalFromCOG(watchedVendorId, {
          effectiveDate: watchedEffective || null,
          expirationDate: watchedExpiration || null,
        })
        if (cancelled) return
        if (r.totalValue > 0 && currentTotal === 0) {
          form.setValue("totalValue", r.totalValue)
        }
        if (r.annualValue > 0 && currentAnnual === 0) {
          form.setValue("annualValue", r.annualValue)
        }
      } catch {
        // Silent — user can manually re-enter values.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [initialized, watchedVendorId, watchedEffective, watchedExpiration, form])

  async function handleSave() {
    const isValid = await form.trigger()
    if (!isValid) {
      toast.error("Please fix the form errors")
      return
    }

    // Charles W1.W-E3 — pre-validate terms BEFORE we kick off the
    // contract-level update. Previously an invalid term (blank dates,
    // missing term name) would throw inside the save loop, the outer
    // try/catch would surface "Save failed", but by then the
    // contract-type change had already committed. The user saw their
    // type change persist and their new rebate tier vanish. Fail fast
    // instead so neither half half-commits.
    //
    // Seed blank date fields from the contract's own dates so a user
    // who added a term mid-type-change isn't blocked on typing dates
    // they almost always copy verbatim from the header.
    const contractStart = contract
      ? new Date(contract.effectiveDate).toISOString().split("T")[0]
      : ""
    const contractEnd = contract
      ? new Date(contract.expirationDate).toISOString().split("T")[0]
      : ""
    const seededTerms = terms.map((t) => ({
      ...t,
      effectiveStart: t.effectiveStart || contractStart,
      effectiveEnd: t.effectiveEnd || contractEnd,
      termName:
        t.termName ||
        (t.termType ? `${t.termType.replace(/_/g, " ")} term` : "Rebate term"),
    }))
    const invalidTerm = seededTerms.find(
      (t) => !t.termName || !t.effectiveStart || !t.effectiveEnd,
    )
    if (invalidTerm) {
      toast.error(
        "Each term needs a name and effective/expiration dates — check the Terms tab",
      )
      return
    }

    const values = form.getValues()

    // Charles R5.36 P0 — wrap the whole save in a try/catch so a
    // downstream term/tier op failing doesn't silently abort the flow
    // after the header update already persisted. Previously the user
    // would see the "Contract updated successfully" toast (from the
    // mutation's onSuccess) and land on a page that still showed stale
    // term/tier values, because the partially-completed save threw
    // before `router.push` ran and there was no visible error.
    try {
      // Charles W1.T — include tie-in capital in the contract update
      // payload. updateContract is the one that writes the 6 capital
      // columns + ContractAmortizationSchedule rows on the contract.
      await updateMutation.mutateAsync({
        id: contractId,
        data: {
          ...values,
          capitalCost: capital.capitalCost,
          interestRate: capital.interestRate,
          termMonths: capital.termMonths,
          downPayment: capital.downPayment,
          paymentCadence: capital.paymentCadence,
          amortizationShape: capital.amortizationShape,
          customAmortizationRows: capital.customAmortizationRows,
        },
      })

      // Sync terms: delete removed, create new, update existing tiers
      if (contract) {
        const existingIds = contract.terms.map((t) => t.id)
        const currentIds = seededTerms
          .filter((t) => t.id)
          .map((t) => t.id as string)

        // Delete removed terms
        for (const existingId of existingIds) {
          if (!currentIds.includes(existingId)) {
            await deleteContractTerm(existingId)
          }
        }

        // Create new terms and update tiers of existing
        for (const term of seededTerms) {
          if (term.id) {
            // Persist term-level edits in addition to tier changes.
            // Charles W1.T — capital fields no longer ride with the term
            // update (they're written on the contract update above).
            await updateContractTerm(term.id, {
              termName: term.termName,
              termType: term.termType,
              baselineType: term.baselineType,
              evaluationPeriod: term.evaluationPeriod,
              paymentTiming: term.paymentTiming,
              appliesTo: term.appliesTo,
              rebateMethod: term.rebateMethod,
              effectiveStart: term.effectiveStart,
              effectiveEnd: term.effectiveEnd,
              volumeType: term.volumeType,
              spendBaseline: term.spendBaseline,
              volumeBaseline: term.volumeBaseline,
              growthBaselinePercent: term.growthBaselinePercent,
              desiredMarketShare: term.desiredMarketShare,
              scopedCategoryId: term.scopedCategoryId,
              scopedCategoryIds: term.scopedCategoryIds,
              scopedItemNumbers: term.scopedItemNumbers,
              minimumPurchaseCommitment: term.minimumPurchaseCommitment,
            })
            await upsertContractTiers(term.id, term.tiers)
          } else {
            await createContractTerm({
              ...term,
              contractId,
            })
          }
        }
      }

      // Invalidate every consumer of tier-derived math (Charles
      // iMessage 2026-04-20 R3/N16: term-type and tier edits now
      // trigger recompute server-side but the client was caching stale
      // ledger/detail queries, so the UI looked frozen after save).
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.contracts.detail(contractId),
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.contracts.all,
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.contractTerms.list(contractId),
        }),
        queryClient.invalidateQueries({
          queryKey: ["contractRebates", contractId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["contract-periods", contractId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["contractPeriods", contractId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["contract-accrual-timeline", contractId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["contract-capital-schedule", contractId],
        }),
      ])

      router.push(`/dashboard/contracts/${contractId}`)
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to save contract changes"
      toast.error(`Save failed: ${message}`)
    }
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
            categories={liveCategories ?? categories}
            onCreateCategory={async (name) => {
              const created = await createCategory({ name })
              await queryClient.invalidateQueries({ queryKey: queryKeys.categories.all })
              toast.success(`Created category "${created.name}"`)
              return { id: created.id, name: created.name }
            }}
          />
        </TabsContent>

        <TabsContent value="terms" className="mt-6 space-y-6">
          {/* Charles W1.W-E3 — drive capital-card visibility and the
              terms-entry type-change defaults off the LIVE form state,
              not the DB-loaded `contract.contractType`. Without this,
              changing the type mid-edit (e.g. pricing_only → usage or
              tie_in) doesn't propagate into ContractTermsEntry's
              contractType prop, so the tie-in capital auto-fill effect
              (and any future contractType-dependent behavior) sees a
              stale value. */}
          {form.watch("contractType") === "tie_in" && (
            <ContractCapitalEntry
              capital={capital}
              onChange={(patch) =>
                setCapital((prev) => ({ ...prev, ...patch }))
              }
              effectiveDate={
                contract
                  ? new Date(contract.effectiveDate)
                      .toISOString()
                      .split("T")[0]
                  : null
              }
            />
          )}
          <ContractTermsEntry
            terms={terms}
            onChange={setTerms}
            contractType={form.watch("contractType")}
          />
        </TabsContent>

        <TabsContent value="documents" className="mt-6">
          <ContractDocumentsList documents={contract.documents} contractId={contractId} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
