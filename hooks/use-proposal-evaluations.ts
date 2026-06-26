"use client"

import { useQuery } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import { useToastMutation } from "@/hooks/use-toast-mutation"
import {
  getProposalEvaluations,
  saveProposalEvaluation,
  updateProposalEvaluation,
  deleteProposalEvaluation,
  deleteProposalEvaluationsBySource,
  type SaveProposalEvaluationInput,
} from "@/lib/actions/proposal-evaluations"

export function useProposalEvaluations() {
  return useQuery({
    queryKey: queryKeys.prospectiveAnalysis.evaluations,
    queryFn: () => getProposalEvaluations(),
  })
}

export function useSaveProposalEvaluation() {
  return useToastMutation(saveProposalEvaluation, {
    invalidate: [queryKeys.prospectiveAnalysis.evaluationsBase],
    success: "Proposal evaluation saved",
    error: "Failed to save evaluation",
  })
}

export function useUpdateProposalEvaluation() {
  return useToastMutation(
    (vars: { id: string; input: SaveProposalEvaluationInput }) =>
      updateProposalEvaluation(vars.id, vars.input),
    {
      invalidate: [queryKeys.prospectiveAnalysis.evaluationsBase],
      success: "Evaluation re-run",
      error: "Failed to update evaluation",
    },
  )
}

export function useDeleteProposalEvaluation() {
  return useToastMutation(deleteProposalEvaluation, {
    invalidate: [queryKeys.prospectiveAnalysis.evaluationsBase],
    success: "Evaluation removed",
    error: "Failed to remove evaluation",
  })
}

export function useDeleteProposalEvaluationsBySource() {
  return useToastMutation(deleteProposalEvaluationsBySource, {
    invalidate: [queryKeys.prospectiveAnalysis.evaluationsBase],
    error: "Failed to clear evaluations",
  })
}
