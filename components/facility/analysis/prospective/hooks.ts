"use client"

/**
 * TanStack Query hooks for the prospective-analysis UI.
 *
 * Thin wrappers around the server actions in
 * `lib/actions/prospective-analysis.ts` (scoring, COG patterns, PDF clause
 * analysis, comparison).
 */

import { useMutation, useQuery } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  analyzeProposal,
  getVendorCOGPatterns,
  analyzeUploadedPDF,
  type AnalyzeProposalInput,
  type AnalyzeProposalResult,
  type SpendPatternAnalysis,
  type ClauseAnalysis,
} from "@/lib/actions/prospective-analysis"

export function useAnalyzeProspectiveProposal() {
  return useMutation<AnalyzeProposalResult, Error, AnalyzeProposalInput>({
    mutationFn: (input) => analyzeProposal(input),
    onError: (err) => {
      toast.error(err.message || "Failed to score proposal")
    },
  })
}

export function useVendorCOGPatterns(vendorId: string | null) {
  return useQuery<SpendPatternAnalysis>({
    queryKey: ["prospective", "vendorCOGPatterns", vendorId],
    queryFn: () => {
      if (!vendorId) throw new Error("vendorId required")
      return getVendorCOGPatterns(vendorId)
    },
    enabled: !!vendorId,
    staleTime: 60_000,
  })
}

export function useAnalyzePDFClauses() {
  return useMutation<
    ClauseAnalysis,
    Error,
    { pdfText: string; fileName?: string }
  >({
    mutationFn: (input) => analyzeUploadedPDF(input),
    onError: (err) => {
      toast.error(err.message || "Failed to analyze PDF clauses")
    },
  })
}
