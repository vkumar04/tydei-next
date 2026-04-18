/**
 * Canonical suggested-question chips for the AI Agent chat tab empty state.
 *
 * Six category-labelled prompts are rendered as clickable chips when the
 * conversation has zero messages. Clicking a chip dispatches
 * `sendMessage({ text: question })` bypassing the input field.
 *
 * Shape + copy for the facility audience are verbatim from the
 * `2026-04-18-ai-agent-rewrite.md` spec §2 (subsystem 1). The vendor list
 * mirrors the same six categories with vendor-perspective copy for the
 * future vendor-portal AI agent surface.
 *
 * Pure module — no React, no server imports — so it is safe to use from
 * both RSC and client components, and from Vitest without extra setup.
 */

export interface SuggestedQuestion {
  category:
    | "Contract Performance"
    | "Rebate Analysis"
    | "Alerts Summary"
    | "Cost Savings"
    | "Market Share"
    | "Surgeon Metrics"
  question: string
}

/** The 6 canonical empty-state chips from facility-ai-agent spec §2. */
export const FACILITY_SUGGESTED_QUESTIONS: readonly SuggestedQuestion[] = [
  {
    category: "Contract Performance",
    question: "How are our top contracts performing this quarter?",
  },
  {
    category: "Rebate Analysis",
    question:
      "What is our total earned rebate this year and how close are we to hitting the next tier?",
  },
  {
    category: "Alerts Summary",
    question: "What are the critical alerts I should address today?",
  },
  {
    category: "Cost Savings",
    question: "Where are our biggest opportunities to save money on contracts?",
  },
  {
    category: "Market Share",
    question: "What does our market share look like across product categories?",
  },
  {
    category: "Surgeon Metrics",
    question: "Which surgeons have the best spend efficiency scores?",
  },
] as const

/**
 * Vendor-portal analogs of the six facility chips. Same categories, but
 * copy is framed from a vendor's perspective (their contracts, their
 * rebates paid, their market share).
 */
export const VENDOR_SUGGESTED_QUESTIONS: readonly SuggestedQuestion[] = [
  {
    category: "Contract Performance",
    question: "Which of my active contracts have the highest spend this quarter?",
  },
  {
    category: "Rebate Analysis",
    question: "How much rebate have I paid out this year and to which facilities?",
  },
  {
    category: "Alerts Summary",
    question: "What vendor alerts should I review today?",
  },
  {
    category: "Cost Savings",
    question: "Which of my contracts are close to tier advancement?",
  },
  {
    category: "Market Share",
    question: "What's my market share across my top 3 product categories?",
  },
  {
    category: "Surgeon Metrics",
    question: "Which facilities are increasing volume on my products?",
  },
] as const

/**
 * Returns the empty-state chip list for the given audience.
 *
 * The two surfaces (`facility` dashboard + `vendor` portal) render the same
 * chip grid component with an audience prop; this helper is the single
 * switchover point so the caller never branches on the string literal.
 */
export function getSuggestedQuestions(
  audience: "facility" | "vendor",
): readonly SuggestedQuestion[] {
  return audience === "vendor"
    ? VENDOR_SUGGESTED_QUESTIONS
    : FACILITY_SUGGESTED_QUESTIONS
}
