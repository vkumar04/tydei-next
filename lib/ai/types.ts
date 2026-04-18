/**
 * Shared TypeScript types for AI surfaces.
 *
 * These types are the **contract between AI server actions and UI**.
 * Every AI advisor across COG, contracts, prospective, and the
 * quality-narrator pipeline normalizes to `AiAdvisoryProposal` so the
 * shared review UI (see `components/shared/ai/`, landing in subsystem 4)
 * can render any proposal without special-casing per feature.
 *
 * See spec `docs/superpowers/specs/2026-04-18-ai-integration-foundation.md`,
 * §2.7 (the review surface pattern) for the full UX rationale.
 */

/**
 * Proposal advisory shape — every AI advisor across COG / contracts /
 * prospective returns this shape for UI pair-wise confirmation.
 *
 * The generic `TSuggestion` lets per-feature code specialize on the
 * concrete suggestion payload (e.g. `VendorDedupSuggestion`) while
 * keeping the render-time API uniform.
 */
export interface AiAdvisoryProposal<TSuggestion = unknown> {
  /** Stable id for this proposal (used for tracking confirmations). */
  id: string
  /** The proposal kind. */
  kind:
    | "vendor_dedup"
    | "item_dedup"
    | "column_mapping"
    | "division_inference"
    | "match_status_explainer"
    | "contract_change"
  /** Short human-readable title. */
  title: string
  /** Long explanation. */
  reasoning: string
  /** Confidence 0-1. */
  confidence: number
  /** The concrete suggestion — shape varies by kind. */
  suggestion: TSuggestion
  /** Alternative suggestions, if any. */
  alternatives?: TSuggestion[]
  /** Timestamp the proposal was generated. */
  generatedAt: Date
}

/**
 * Review-panel state machine. The shared review UI (subsystem 4) flips
 * through these states as the server action resolves. Single source of
 * truth so every surface (COG upload, contracts change review, etc.)
 * handles loading / error / empty identically.
 *
 * - `idle` — panel not yet invoked (initial mount)
 * - `loading` — server action in flight
 * - `error` — request or parse failed; `message` is user-facing
 * - `ready` — `proposals` populated; render the pair-wise cards
 */
export type AiReviewPanelState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; proposals: AiAdvisoryProposal[] }
