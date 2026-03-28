# Phase 9 -- AI Features

## Objective

Integrate AI-powered capabilities across the platform: contract PDF extraction during creation, streaming chat agent for both portals, AI deal analysis/scoring, AI supply matching for case costing, and an AI credit system. All AI features gated behind feature flags.

## Dependencies

- Phase 8 (case costing for supply matching, prospective analysis for deal scoring)
- Phase 2 (contracts for PDF extraction)

## Tech Stack

| Tool | Purpose |
|------|---------|
| Vercel AI SDK (`ai`) | Core AI orchestration, streaming, structured output |
| `@ai-sdk/google` | Google Gemini model provider |
| Zod | Structured output schemas for AI extraction |
| shadcn | ScrollArea, Avatar, Input, Tabs, Dialog, Progress |

---

## Server Actions & API Routes

### `app/api/ai/extract-contract/route.ts`

```typescript
// POST -- accepts PDF file, returns structured contract data
// Uses generateObject with Zod schema for:
//   contractName, vendorName, contractType, effectiveDate, expirationDate,
//   terms: [{ termName, termType, tiers: [{ tierNumber, spendMin, spendMax, rebateType, rebateValue }] }],
//   facilities, description
// Input: FormData with file
// Output: { extracted: ExtractedContractData; confidence: number }
```

### `app/api/ai/chat/route.ts`

```typescript
// POST -- streaming chat endpoint
// Uses streamText with tool-calling for structured data retrieval
// Tools:
//   - getContractPerformance(contractId): contract spend, tier, rebate data
//   - getMarketShareAnalysis(vendorId, facilityId): market share breakdown
//   - getSpendAnalysis(facilityId, dateRange): spend by vendor/category
//   - getRebateProjection(contractId): projected rebate for current period
//   - getOptimizationSuggestions(facilityId): rebate optimization tips
// System prompt differs per portal role (facility vs vendor)
// Input: { messages: Message[]; portalType: "facility" | "vendor"; entityId: string }
// Output: streaming text response
```

### `app/api/ai/score-deal/route.ts`

```typescript
// POST -- AI-powered deal scoring
// Uses generateObject with Zod schema for multi-dimension score
// Input: { contractData: ContractData; cogData: COGSummary; benchmarkData?: BenchmarkSummary }
// Output: { scores: DealScores; recommendation: string; negotiationAdvice: string[] }
```

### `app/api/ai/match-supplies/route.ts`

```typescript
// POST -- AI supply matching for case costing
// When vendor_item_no doesn't exact-match contract pricing, AI finds closest match
// Uses generateObject with Zod schema
// Input: { supplyName: string; vendorItemNo?: string; contractPricing: ContractPricingItem[] }
// Output: { matchedItem: ContractPricingItem | null; confidence: number; reasoning: string }
```

### `lib/actions/ai-credits.ts`

```typescript
"use server"

// Get AI credit balance
export async function getAICredits(input: {
  facilityId?: string
  vendorId?: string
}): Promise<AICredit>

// Use credits for an action
export async function useAICredits(input: {
  creditId: string
  action: string
  creditsUsed: number
  userId: string
  userName: string
  description: string
}): Promise<{ success: boolean; remaining: number }>

// Get usage history
export async function getAIUsageHistory(creditId: string): Promise<AIUsageRecord[]>

// Check if enough credits available
export async function checkAICredits(input: {
  facilityId?: string
  vendorId?: string
  action: string
  quantity?: number
}): Promise<{ available: boolean; cost: number; remaining: number }>
```

---

## AI Configuration

### `lib/ai/config.ts`

```typescript
// ~30 lines
import { google } from "@ai-sdk/google"

export const geminiModel = google("gemini-1.5-flash")
export const geminiProModel = google("gemini-1.5-pro")

// Credit costs per action
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
```

### `lib/ai/schemas.ts`

```typescript
// ~80 lines
// Zod schemas for AI structured output

export const extractedContractSchema = z.object({
  contractName: z.string(),
  vendorName: z.string(),
  contractType: z.enum(["usage", "capital", "service", "tie_in", "grouped", "pricing_only"]),
  effectiveDate: z.string(),
  expirationDate: z.string(),
  totalValue: z.number().optional(),
  description: z.string().optional(),
  terms: z.array(z.object({
    termName: z.string(),
    termType: z.string(),
    tiers: z.array(z.object({
      tierNumber: z.number(),
      spendMin: z.number().optional(),
      spendMax: z.number().optional(),
      rebateType: z.string().optional(),
      rebateValue: z.number().optional(),
    })),
  })),
})

export const dealScoreSchema = z.object({
  financialValue: z.number().min(0).max(100),
  rebateEfficiency: z.number().min(0).max(100),
  pricingCompetitiveness: z.number().min(0).max(100),
  marketShareAlignment: z.number().min(0).max(100),
  complianceLikelihood: z.number().min(0).max(100),
  overallScore: z.number().min(0).max(100),
  recommendation: z.string(),
  negotiationAdvice: z.array(z.string()),
})

export const supplyMatchSchema = z.object({
  matchedVendorItemNo: z.string().nullable(),
  matchedDescription: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
})
```

### `lib/ai/tools.ts`

```typescript
// ~100 lines
// Tool definitions for chat agent
// Each tool: name, description, parameters (Zod), execute function
// Tools query the database via server actions

export const chatTools = {
  getContractPerformance: tool({ ... }),
  getMarketShareAnalysis: tool({ ... }),
  getSpendAnalysis: tool({ ... }),
  getRebateProjection: tool({ ... }),
  getOptimizationSuggestions: tool({ ... }),
}
```

### `lib/ai/prompts.ts`

```typescript
// ~60 lines
// System prompts per portal role

export const facilitySystemPrompt = `You are an AI assistant for a healthcare facility supply chain manager...`
export const vendorSystemPrompt = `You are an AI assistant for a medical device/supply vendor representative...`

export const suggestedQuestions = {
  facility: [
    "What's my total rebate earned this quarter?",
    "Which contracts are close to reaching the next tier?",
    "Show me off-contract spend by vendor",
    "What's my compliance rate across all contracts?",
  ],
  vendor: [
    "What's my market share at each facility?",
    "Which contracts are expiring soon?",
    "How does my pricing compare to benchmarks?",
    "What spend targets should I focus on?",
  ],
}
```

---

## Components

### Contract PDF Extraction

#### `components/contracts/ai-extract-dialog.tsx`

- **Props:** `{ open: boolean; onOpenChange: (open: boolean) => void; onExtracted: (data: ExtractedContractData) => void }`
- **shadcn deps:** Dialog, Button, Progress, Card
- **States:** uploading, extracting, result, error
- **Description:** PDF upload dialog that sends to AI extraction endpoint, shows progress, then displays extracted fields for review/edit before populating the contract form. ~70 lines.

#### `components/contracts/ai-extract-review.tsx`

- **Props:** `{ extracted: ExtractedContractData; confidence: number; onAccept: (data: ExtractedContractData) => void; onEdit: (field: string, value: unknown) => void }`
- **shadcn deps:** Card, Badge, Input, Button
- **Description:** Review extracted contract data with confidence indicators per field. Edit inline before accepting. ~60 lines.

### AI Chat Agent

#### `components/shared/ai/chat-interface.tsx`

- **Props:** `{ portalType: "facility" | "vendor"; entityId: string }`
- **shadcn deps:** ScrollArea, Avatar, Input, Button, Card
- **States:** messages, isLoading, input
- **Description:** Full chat interface with message list, streaming response display, and input bar. Uses `useChat` from Vercel AI SDK. ~80 lines.

#### `components/shared/ai/chat-message.tsx`

- **Props:** `{ message: Message; isUser: boolean }`
- **shadcn deps:** Avatar, Card
- **Description:** Single chat message bubble with avatar, markdown rendering, and tool call results. ~35 lines.

#### `components/shared/ai/suggested-questions.tsx`

- **Props:** `{ questions: string[]; onSelect: (question: string) => void }`
- **shadcn deps:** Button
- **Description:** Grid of suggested question buttons shown when chat is empty. ~20 lines.

#### `components/shared/ai/credit-indicator.tsx`

- **Props:** `{ remaining: number; total: number; tier: string }`
- **shadcn deps:** Progress, Badge
- **Description:** Shows remaining AI credits with progress bar. ~20 lines.

### AI Deal Scoring

#### `components/contracts/ai-score-page.tsx`

- **Props:** `{ contractId: string }`
- **shadcn deps:** Card, Badge, Tabs
- **Description:** Contract scoring page that calls AI scoring endpoint. Renders radar chart (reuses DealScoreRadar), recommendation, and negotiation advice. ~60 lines.

### AI Supply Matching (Case Costing Integration)

#### `components/facility/case-costing/ai-supply-match.tsx`

- **Props:** `{ supply: CaseSupply; contractPricing: ContractPricing[]; onMatch: (matchedItem: ContractPricing) => void }`
- **shadcn deps:** Button, Badge, Card
- **Description:** Shows AI match suggestion for unmatched supply items. Displays confidence score and reasoning. ~40 lines.

### Credit Management

#### `components/shared/ai/credit-usage-card.tsx`

- **Props:** `{ credits: AICredit; usageRecords: AIUsageRecord[] }`
- **shadcn deps:** Card, Progress, Table
- **Description:** Credit overview with tier, usage bar, and recent usage history table. ~45 lines.

---

## Pages

### Facility AI Pages

#### `app/(facility)/dashboard/ai-agent/page.tsx`

- **Route:** `/dashboard/ai-agent`
- **Auth:** facility role + feature flag check (aiAgentEnabled)
- **Data loading:** AI credits check
- **Content:** PageHeader + CreditIndicator + ChatInterface + SuggestedQuestions
- **Lines:** ~40 lines

#### `app/(facility)/dashboard/contracts/[id]/score/page.tsx`

- **Route:** `/dashboard/contracts/[id]/score`
- **Auth:** facility role
- **Data loading:** contract detail + AI scoring
- **Content:** PageHeader + AIScorePage
- **Lines:** ~30 lines

### Vendor AI Pages

#### `app/(vendor)/ai-agent/page.tsx`

- **Route:** `/vendor/ai-agent`
- **Auth:** vendor role + feature flag check
- **Data loading:** AI credits check
- **Content:** PageHeader + CreditIndicator + ChatInterface + SuggestedQuestions
- **Lines:** ~40 lines

---

## Hooks

### `hooks/use-ai-credits.ts`

- **Description:** Hook that checks credit balance before AI operations, deducts on use, and shows warning when low. ~40 lines.

---

## Query Keys

```typescript
ai: {
  credits: (entityId: string) => ["ai", "credits", entityId],
  usageHistory: (creditId: string) => ["ai", "usageHistory", creditId],
},
```

---

## File Checklist

### API Routes
- [ ] `app/api/ai/extract-contract/route.ts`
- [ ] `app/api/ai/chat/route.ts`
- [ ] `app/api/ai/score-deal/route.ts`
- [ ] `app/api/ai/match-supplies/route.ts`

### Server Actions
- [ ] `lib/actions/ai-credits.ts`

### AI Configuration
- [ ] `lib/ai/config.ts`
- [ ] `lib/ai/schemas.ts`
- [ ] `lib/ai/tools.ts`
- [ ] `lib/ai/prompts.ts`

### Contract Extraction Components
- [ ] `components/contracts/ai-extract-dialog.tsx`
- [ ] `components/contracts/ai-extract-review.tsx`

### Chat Components
- [ ] `components/shared/ai/chat-interface.tsx`
- [ ] `components/shared/ai/chat-message.tsx`
- [ ] `components/shared/ai/suggested-questions.tsx`
- [ ] `components/shared/ai/credit-indicator.tsx`

### Scoring Components
- [ ] `components/contracts/ai-score-page.tsx`

### Supply Matching
- [ ] `components/facility/case-costing/ai-supply-match.tsx`

### Credit Components
- [ ] `components/shared/ai/credit-usage-card.tsx`

### Pages
- [ ] `app/(facility)/dashboard/ai-agent/page.tsx`
- [ ] `app/(facility)/dashboard/contracts/[id]/score/page.tsx`
- [ ] `app/(vendor)/ai-agent/page.tsx`

### Hooks
- [ ] `hooks/use-ai-credits.ts`

### Integration Points (modify existing)
- [ ] `components/contracts/contract-form.tsx` -- add "AI Extract" button at top (link to AIExtractDialog)
- [ ] `app/(facility)/dashboard/contracts/new/page.tsx` -- wire AI extraction into form prefill
- [ ] `components/facility/case-costing/case-detail.tsx` -- add AI match button for unmatched supplies

---

## Acceptance Criteria

1. Contract PDF upload extracts structured data (name, vendor, type, dates, terms with tiers)
2. Extracted data shows confidence scores and allows inline editing before acceptance
3. Accepted extraction pre-fills the contract creation form
4. AI chat agent streams responses in real-time for facility users
5. AI chat agent streams responses in real-time for vendor users
6. Chat supports suggested questions on empty state
7. Chat tools correctly retrieve contract performance, market share, spend analysis data
8. Contract scoring page renders radar chart with 5 dimensions and overall score
9. AI provides negotiation advice as actionable bullet points
10. AI supply matching suggests closest contract pricing match with confidence score
11. Credit system tracks usage per AI action
12. Credit indicator shows remaining/total with progress bar
13. AI features are gated behind feature flags (disabled shows "Enable in Settings" message)
14. Insufficient credits shows upgrade prompt
15. All pages are THIN (30-40 lines)
