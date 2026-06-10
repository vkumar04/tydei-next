"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import {
  createProposal,
  deleteProposal,
  getVendorProposals,
  getVendorBenchmarks,
} from "@/lib/actions/prospective"
import { toast } from "sonner"

// NOTE: useScoreDeal / useFinancialProjections were removed on
// 2026-06-10 (audit H2) — both hooks had zero consumers. Proposal
// scoring now flows through the Deal Scorer
// (getVendorProspectiveAnalysis with a proposalRowId).

export function useCreateProposal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: createProposal,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["prospective"] })
      toast.success("Proposal draft created")
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

export function useVendorBenchmarks(vendorId: string) {
  return useQuery({
    queryKey: ["prospective", "vendorBenchmarks", vendorId],
    queryFn: () => getVendorBenchmarks(),
    enabled: !!vendorId,
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
