// AI Gateway model identifiers (provider/model string IDs). Vercel
// AI SDK v6 accepts strings directly via `model: 'anthropic/...'`
// and routes through the Vercel AI Gateway — giving us provider
// fallback, unified billing, observability, and zero data retention
// without coupling the code to one provider's SDK.
//
// Per Vercel platform guidance (Feb 2026): "prefer plain
// 'provider/model' strings through the gateway by default; do not
// default to provider-specific packages like @ai-sdk/anthropic
// unless the user explicitly asks for direct provider wiring."
//
// `providerOptions.anthropic.*` (cache control, etc.) is still
// honored on gateway-routed calls — the option block keys off the
// provider name, not the SDK shape.
//
// Model selection defaults to Claude Opus 4.7 (latest). Each
// endpoint can opt into Sonnet/Haiku for mechanical tasks
// (classification, column mapping, etc.).
export const claudeModel = "anthropic/claude-opus-4-7" as const

// Faster / cheaper models for mechanical tasks.
export const claudeSonnet = "anthropic/claude-sonnet-4-6" as const
export const claudeHaiku = "anthropic/claude-haiku-4-5-20251001" as const

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
