"use client"

import { useState, useCallback, useMemo } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import { useContract } from "@/hooks/use-contracts"
import {
  getContractTerms,
  createContractTerm,
  updateContractTerm,
  deleteContractTerm,
  upsertContractTiers,
} from "@/lib/actions/contract-terms"
import { getCategories } from "@/lib/actions/categories"
import { ContractTermsDisplay } from "@/components/contracts/contract-terms-display"
import { ContractTermsEntry } from "@/components/contracts/contract-terms-entry"
import { PageHeader } from "@/components/shared/page-header"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ArrowLeft, Pencil, Save, X } from "lucide-react"
import { toast } from "sonner"
import Link from "next/link"
import type { TermFormValues, TierInput } from "@/lib/validators/contract-terms"

interface ContractTermsPageClientProps {
  contractId: string
}

export function ContractTermsPageClient({ contractId }: ContractTermsPageClientProps) {
  const queryClient = useQueryClient()
  const { data: contract, isLoading: contractLoading } = useContract(contractId)
  const { data: terms, isLoading: termsLoading } = useQuery({
    queryKey: queryKeys.contractTerms.list(contractId),
    queryFn: () => getContractTerms(contractId),
  })

  // Fall-back global category list — used when the contract has no
  // populated ContractProductCategory join rows (e.g. seeded contracts
  // which only set the single productCategoryId column). Without this
  // the category picker renders empty and the user is told "add at
  // least one Category to the contract above" even when the contract
  // genuinely has categories.
  const { data: allCategories } = useQuery({
    queryKey: queryKeys.categories.all,
    queryFn: () => getCategories(),
  })

  const availableCategories = useMemo(() => {
    const map = new Map<string, { id: string; name: string }>()
    // 1. Contract's primary productCategory.
    if (contract?.productCategory) {
      map.set(contract.productCategory.id, {
        id: contract.productCategory.id,
        name: contract.productCategory.name,
      })
    }
    // 2. Any join-table categories linked to the contract.
    for (const cc of contract?.contractCategories ?? []) {
      const pc = cc.productCategory
      if (pc?.id && pc?.name && !map.has(pc.id)) {
        map.set(pc.id, { id: pc.id, name: pc.name })
      }
    }
    // 3. Fallback: if the contract has no linked categories at all,
    //    show the full platform category list so category-scoped tiers
    //    can still be created.
    if (map.size === 0 && allCategories) {
      for (const c of allCategories) {
        map.set(c.id, { id: c.id, name: c.name })
      }
    }
    return Array.from(map.values())
  }, [contract, allCategories])

  const [editing, setEditing] = useState(false)
  const [editTerms, setEditTerms] = useState<TermFormValues[]>([])
  const [saving, setSaving] = useState(false)

  const startEditing = useCallback(() => {
    if (!terms) return
    const mapped: TermFormValues[] = terms.map((t) => ({
      id: t.id,
      termName: t.termName,
      termType: t.termType as TermFormValues["termType"],
      baselineType: t.baselineType as TermFormValues["baselineType"],
      evaluationPeriod: t.evaluationPeriod ?? "annual",
      paymentTiming: t.paymentTiming ?? "quarterly",
      appliesTo: t.appliesTo ?? "all_products",
      rebateMethod: (t.rebateMethod ?? "cumulative") as TermFormValues["rebateMethod"],
      effectiveStart: String(t.effectiveStart).slice(0, 10),
      effectiveEnd: String(t.effectiveEnd).slice(0, 10),
      spendBaseline: t.spendBaseline ? Number(t.spendBaseline) : undefined,
      tiers: t.tiers.map((tier) => ({
        id: tier.id,
        tierNumber: tier.tierNumber,
        spendMin: Number(tier.spendMin),
        spendMax: tier.spendMax ? Number(tier.spendMax) : undefined,
        volumeMin: tier.volumeMin ?? undefined,
        volumeMax: tier.volumeMax ?? undefined,
        marketShareMin: tier.marketShareMin ? Number(tier.marketShareMin) : undefined,
        marketShareMax: tier.marketShareMax ? Number(tier.marketShareMax) : undefined,
        rebateType: tier.rebateType as TierInput["rebateType"],
        rebateValue: Number(tier.rebateValue),
      })),
    }))
    setEditTerms(mapped)
    setEditing(true)
  }, [terms])

  const cancelEditing = () => {
    setEditing(false)
    setEditTerms([])
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const existingIds = new Set((terms ?? []).map((t) => t.id))
      const editIds = new Set(editTerms.filter((t) => t.id).map((t) => t.id!))

      // Delete removed terms
      for (const term of terms ?? []) {
        if (!editIds.has(term.id)) {
          await deleteContractTerm(term.id)
        }
      }

      // Create or update terms
      for (const term of editTerms) {
        if (term.id && existingIds.has(term.id)) {
          // Update existing term
          const { id, tiers, ...rest } = term
          await updateContractTerm(id!, rest)
          await upsertContractTiers(id!, tiers)
        } else {
          // Create new term
          const { id: _id, ...rest } = term
          await createContractTerm({ ...rest, contractId })
        }
      }

      await queryClient.invalidateQueries({ queryKey: queryKeys.contractTerms.list(contractId) })
      toast.success("Terms saved successfully")
      setEditing(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save terms")
    } finally {
      setSaving(false)
    }
  }

  const isLoading = contractLoading || termsLoading

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48 w-full" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${contract?.name ?? "Contract"} — Terms`}
        description="View and manage contract terms and tier structures"
        action={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href={`/dashboard/contracts/${contractId}`}>
                <ArrowLeft className="size-4" /> Back
              </Link>
            </Button>
            {editing ? (
              <>
                <Button variant="outline" size="sm" onClick={cancelEditing} disabled={saving}>
                  <X className="size-4" /> Cancel
                </Button>
                <Button size="sm" onClick={handleSave} disabled={saving}>
                  <Save className="size-4" /> {saving ? "Saving..." : "Save"}
                </Button>
              </>
            ) : (
              <Button size="sm" onClick={startEditing}>
                <Pencil className="size-4" /> Edit Terms
              </Button>
            )}
          </div>
        }
      />

      {editing ? (
        <ContractTermsEntry
          terms={editTerms}
          onChange={setEditTerms}
          availableCategories={availableCategories}
        />
      ) : (
        <ContractTermsDisplay
          terms={terms ?? []}
          currentSpend={contract?.currentSpend ?? undefined}
        />
      )}
    </div>
  )
}
