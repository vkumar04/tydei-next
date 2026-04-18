import { anthropic } from "@ai-sdk/anthropic"

// Default provider: Claude via the Vercel AI SDK's Anthropic adapter.
// We use @ai-sdk/anthropic (not the raw @anthropic-ai/sdk) because the
// rest of the AI layer relies on Vercel AI SDK abstractions (streamText,
// generateObject, convertToModelMessages, toUIMessageStreamResponse,
// @ai-sdk/react's useChat, etc.) that work across providers. @ai-sdk/anthropic
// is Anthropic's official provider for that ecosystem — it calls the
// real Anthropic API, not an OpenAI-compat shim.
//
// Model selection defaults to Claude Opus 4.6. Each endpoint can opt
// into a faster/cheaper model via `claudeHaiku`/`claudeSonnet` if the
// task is mechanical (classification, column mapping, etc.).
export const claudeModel = anthropic("claude-opus-4-6")

// Faster / cheaper models for mechanical tasks. Not currently wired in
// — any caller that wants to downgrade can import directly.
export const claudeSonnet = anthropic("claude-sonnet-4-6")
export const claudeHaiku = anthropic("claude-haiku-4-5")

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
