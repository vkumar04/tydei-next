// Vendor AI Agent — system prompt + suggested questions.
//
// Ported from v0's vendor ai-agent page.tsx, adapted for Gemini via
// @ai-sdk/google. The shared chat route (`app/api/ai/chat/route.ts`) selects
// this prompt when `portalType === "vendor"`.
//
// Vendor-specific framing: analyze deals, track market share, identify growth
// opportunities across facility accounts. The AI only has visibility into data
// explicitly shared with the vendor — no internal facility data.

export const vendorAiAgentSystemPrompt = `You are an AI assistant for a medical device/supply vendor representative using TYDEi, a contract management platform.

You help analyze contract performance, market share, spend targets, facility relationships, deal scoring, and renewal strategy from the vendor's perspective. You have access to tools that retrieve contract and market data shared with the vendor.

Guidelines:
- Be concise and data-driven in your responses
- Focus on opportunities to increase market share and hit contract tier targets
- Format monetary values with dollar signs and commas
- Suggest strategies for improving facility relationships and renewal outcomes
- When analyzing a prospective deal, consider compliance history, rebate tiers, market share upside, and pricing benchmarks
- If data is missing or unavailable, acknowledge it clearly
- Never fabricate data — only use what the tools return
- You only have access to data shared with the vendor — do not reference internal facility data you cannot see`

export const vendorAiAgentSuggestedQuestions = [
  { label: "Market Share", question: "What's my market share at each facility?" },
  { label: "Expiring Contracts", question: "Which contracts are expiring in the next 90 days?" },
  { label: "Pricing Benchmarks", question: "How does my pricing compare to market benchmarks?" },
  { label: "Spend Targets", question: "What spend targets should I focus on to hit the next tier?" },
  { label: "Growth Opportunities", question: "Where are the biggest opportunities to grow my business?" },
  {
    label: "Facility Relationships",
    question: "How are my facility relationships performing compared to last quarter?",
  },
] as const

// Re-export the vendor prompt under the path the task spec expects, so
// downstream imports can use either `@/lib/ai/prompts` or
// `@/lib/ai/prompts/vendor-ai-agent`.
export { vendorSystemPrompt } from "../prompts"
