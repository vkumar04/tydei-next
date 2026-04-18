/**
 * Shared types for the prospective-analysis UI.
 *
 * These are UI-only view models — they adapt the pure engine outputs from
 * `lib/prospective-analysis/*` and the server-action returns from
 * `lib/actions/prospective-analysis.ts` into shapes the tabs consume.
 */

import type {
  AnalyzeProposalInput,
  AnalyzeProposalResult,
  ClauseAnalysis,
  SpendPatternAnalysis,
} from "@/lib/actions/prospective-analysis"
import type { PricingFileAnalysis } from "@/lib/prospective-analysis/pricing-file-analysis"

export type ScoredProposalSource = "upload" | "manual"

/**
 * A session-scoped scored proposal — holds both the input and the engine
 * output so the proposals-tab list and the comparison-tab can re-render
 * without another round-trip.
 */
export interface ScoredProposal {
  id: string
  vendorName: string
  createdAt: string // ISO timestamp
  source: ScoredProposalSource
  input: AnalyzeProposalInput
  result: AnalyzeProposalResult
  /** Optional PDF clause analysis attached when the user uploaded a PDF. */
  clauseAnalysis: ClauseAnalysis | null
}

/**
 * Session-scoped pricing-file analysis — from CSV / XLSX upload.
 */
export interface PricingFileAnalysisRecord {
  id: string
  fileName: string
  vendorName: string | null
  createdAt: string // ISO
  analysis: PricingFileAnalysis
}

export type AnalysisPhase = "idle" | "analyzing" | "complete" | "error"

export type ProspectiveTabId =
  | "upload"
  | "manual"
  | "proposals"
  | "pricing"
  | "compare"

export interface VendorOption {
  id: string
  name: string
  displayName: string | null
}

export type { ClauseAnalysis, SpendPatternAnalysis, PricingFileAnalysis }
