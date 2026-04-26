"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import {
  analyzeProposal,
  scoreDeal,
  getFinancialProjections,
  createProposal,
  deleteProposal,
  getVendorProposals,
} from "@/lib/actions/prospective"
import type { ProposedPricingItem } from "@/lib/actions/prospective"
import { toast } from "sonner"

export function useAnalyzeProposal() {
  return useMutation({
    mutationFn: (input: {
      facilityId: string
      proposedPricing: ProposedPricingItem[]
      vendorId?: string
    }) => analyzeProposal(input),
    onError: (err) => toast.error(err.message || "Analysis failed"),
  })
}

export function useScoreDeal() {
  return useMutation({
    mutationFn: scoreDeal,
    onError: (err) => toast.error(err.message || "Scoring failed"),
  })
}

export function useFinancialProjections(
  contractId: string,
  months: number,
  enabled = true
) {
  return useQuery({
    queryKey: ["analysis", "financialProjections", contractId, months],
    queryFn: () =>
      getFinancialProjections({ contractId, projectionMonths: months }),
    enabled: enabled && !!contractId,
  })
}

export function useCreateProposal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: createProposal,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["prospective"] })
      toast.success("Proposal submitted")
    },
    onError: (err) => toast.error(err.message || "Failed to create proposal"),
  })
}

export function useVendorProposals(vendorId: string) {
  return useQuery({
    queryKey: queryKeys.prospective.vendorProposals(vendorId),
    queryFn: () => getVendorProposals(vendorId),
  })
}

export function useDeleteProposal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteProposal(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["prospective"] })
      toast.success("Proposal deleted")
    },
    onError: (err) => toast.error(err.message || "Failed to delete proposal"),
  })
}
