// AI SDK v6 model handles.
//
// Vercel guidance is to use "provider/model" gateway strings by
// default — but that REQUIRES AI_GATEWAY_API_KEY to be provisioned
// (auto-provisioned on Vercel; not on Railway, where we host).
// Without the gateway key, every AI call 500s with
// "GatewayError: Unauthenticated. Configure AI_GATEWAY_API_KEY or
//  use a provider module."
//
// We use the @ai-sdk/anthropic provider module directly with
// ANTHROPIC_API_KEY (already set in Railway). This is the
// "explicit provider wiring" path Vercel's note allows. If we ever
// migrate to Vercel or provision AI_GATEWAY_API_KEY on Railway,
// flip these back to the "anthropic/<model>" gateway strings to
// pick up multi-provider fallback + unified billing.
//
// `providerOptions.anthropic.*` (cache control, etc.) works the
// same way regardless of which path we use here.
import { anthropic } from "@ai-sdk/anthropic"

export const claudeModel = anthropic("claude-opus-5")

// Faster / cheaper models for mechanical tasks.
export const claudeSonnet = anthropic("claude-sonnet-5")
// Still the current Haiku — there is no Haiku 5. Verified against
// /v1/models with the production key on 2026-07-26.
export const claudeHaiku = anthropic("claude-haiku-4-5-20251001")

export const AI_CREDIT_COSTS = {
  document_extraction_per_page: 2,
  contract_classification: 5,
  full_contract_analysis: 25,
  ai_chat_question: 3,
  ai_contract_description: 5,
  ai_recommendation: 10,
  rebate_calculation: 10,
  contract_comparison: 20,
  market_share_analysis: 15,
  report_generation: 20,
  supply_matching: 5,
} as const

export type AIAction = keyof typeof AI_CREDIT_COSTS
