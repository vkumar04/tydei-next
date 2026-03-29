import { google } from "@ai-sdk/google"

export const geminiModel = google("gemini-2.5-flash")
// Pro requires paid plan — use flash for all routes on free tier
export const geminiProModel = google("gemini-2.5-flash")

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
