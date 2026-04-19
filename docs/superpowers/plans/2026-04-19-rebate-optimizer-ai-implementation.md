# Rebate Optimizer — AI Implementation Plan

**Date:** 2026-04-19
**Spec:** `docs/superpowers/specs/2026-04-19-rebate-optimizer-ai-design.md`
**Scope:** Tier 1 (Smart Recommendations) + Tier 4 (Renewal Brief)

Waves dispatch sequentially — Wave 1 ships Tier 1 end-to-end before Wave 2 starts Tier 4. Each wave has one agent.

## Wave 1 — Tier 1 Smart Recommendations (~4h)

### 1.1 Schemas + types

**File:** `lib/ai/rebate-optimizer-schemas.ts` (new)

```ts
import { z } from "zod"

export const rebateInsightActionSchema = z.enum([
  "redirect_spend",
  "accelerate_purchase",
  "negotiate_tier",
  "log_collection",
  "review_compliance",
])

export const rebateInsightSchema = z.object({
  id: z.string(),
  rank: z.number().int().min(1),
  title: z.string().max(120),
  summary: z.string(),
  rationale: z.string(),
  impactDollars: z.number().nullable(),
  confidence: z.enum(["low", "medium", "high"]),
  actionType: rebateInsightActionSchema,
  citedContractIds: z.array(z.string()),
})

export const rebateInsightsResponseSchema = z.object({
  facilityId: z.string(),
  generatedAt: z.string(),
  insights: z.array(rebateInsightSchema),
  observations: z.array(z.string()).optional(),
})

export type RebateInsight = z.infer<typeof rebateInsightSchema>
export type RebateInsightsResponse = z.infer<typeof rebateInsightsResponseSchema>
```

### 1.2 Schema cache table (Prisma)

Add to `prisma/schema.prisma`:

```prisma
model RebateInsightCache {
  id          String   @id @default(cuid())
  facilityId  String
  inputHash   String   // hash of opportunity + alert state
  response    Json     // RebateInsightsResponse
  model       String   // e.g. "claude-opus-4-6"
  costCents   Int?     // optional: usage.input_tokens * rate + output
  createdAt   DateTime @default(now())
  expiresAt   DateTime // createdAt + 15min

  facility Facility @relation(fields: [facilityId], references: [id], onDelete: Cascade)

  @@index([facilityId, expiresAt])
  @@index([facilityId, inputHash])
  @@map("rebate_insight_cache")
}

model RebateInsightFlag {
  id         String   @id @default(cuid())
  facilityId String
  insightId  String       // stable ID from RebateInsight.id
  title      String
  summary    String
  snapshot   Json         // full insight snapshot for history
  flaggedBy  String       // userId
  createdAt  DateTime @default(now())

  facility Facility @relation(fields: [facilityId], references: [id], onDelete: Cascade)
  user     User     @relation(fields: [flaggedBy], references: [id])

  @@index([facilityId, createdAt])
  @@map("rebate_insight_flag")
}
```

Back-relations on `Facility` + `User`:

```
rebateInsightCaches RebateInsightCache[]
rebateInsightFlags  RebateInsightFlag[]
```

Run: `bun run db:push` after editing.

### 1.3 Server action

**File:** `lib/actions/rebate-optimizer-insights.ts` (new, `"use server"`)

Exports:
- `getRebateOptimizerInsights(facilityId: string, opts?: { forceFresh?: boolean }): Promise<RebateInsightsResponse>`
- `flagRebateInsight(input: { insightId: string; snapshot: RebateInsight }): Promise<{ id: string }>`
- `listRebateInsightFlags(facilityId: string): Promise<FlagRow[]>`
- `clearRebateInsightFlag(id: string): Promise<void>`

Implementation for `getRebateOptimizerInsights`:
1. `requireFacility()` — scope to current facility
2. Call existing `getRebateOpportunities(facilityId)` + `generateRebateAlerts(...)` + new `getLast90DaysVendorSpend(facilityId)` helper
3. Compute `inputHash = hash(opportunities + alerts + spend)` — stable SHA-256 of canonical JSON
4. Unless `forceFresh`, look up non-expired cache row; return on hit
5. Build system prompt (cached) + user message (inputs as JSON)
6. Call Anthropic:
   ```ts
   const r = await client.messages.stream({
     model: "claude-opus-4-6",
     thinking: { type: "adaptive" },
     system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
     messages: [{ role: "user", content: userMessage }],
     max_tokens: 8000,
     output_config: { format: { type: "json_schema", schema: rebateInsightsResponseSchema } },
   })
   const final = await r.finalMessage()
   ```
7. Validate via `rebateInsightsResponseSchema.parse`
8. Persist cache row, return response

System prompt (string const at top of file):
```
You are a rebate-optimization advisor for medical facility contract managers.
You will receive:
- opportunities: ranked list of contract tier gaps with projected rebate uplift
- alerts: rule-based tier-threshold alerts
- recentSpend: last 90 days of per-vendor spend

Your job: produce 3–6 actionable recommendations ranked by ROI × confidence.
Each recommendation MUST cite at least one contractId from the input.
Every dollar figure you state must be derivable from the input data —
do not invent numbers. If uncertain, say so and drop confidence to "low".

Format: JSON matching the provided schema. Do not emit prose outside the JSON.
```

### 1.4 Hooks

**File:** `hooks/use-rebate-insights.ts` (new)

Exports:
- `useRebateInsights(facilityId)` — TanStack query keyed on `queryKeys.rebateOptimizer.insights(facilityId)`, enabled manually via explicit `generate()` action.
- `useRegenerateRebateInsights(facilityId)` — mutation that calls `getRebateOptimizerInsights(facilityId, { forceFresh: true })`, invalidates the query key on success.
- `useFlagRebateInsight()` — mutation wrapping `flagRebateInsight`.

### 1.5 UI

**Modify:** `components/facility/rebate-optimizer/optimizer-client.tsx`

Add new section at the top (above the KPI cards):
- A shadcn `Collapsible` (default closed) titled **"Smart Recommendations (AI)"** with a Sparkles icon.
- When expanded:
  - If no cached result: a primary "Generate Smart Recommendations" button + a one-line "Uses Claude Opus to analyze your portfolio — ~10 seconds."
  - On click: loading state with a skeleton of 3 insight cards. Stream into cards as the response decodes.
  - After: render insight cards (one per `insights[i]`) with:
    - Rank badge + title
    - Summary (1-2 sentences)
    - Collapsible rationale (the multi-sentence explanation)
    - Impact: `$X` + confidence pill
    - Action buttons: `[Open in Scenario Builder]` + `[Flag for review]`
    - Small "Citations: <contract names>" line linking to each `citedContractId`'s detail page
  - "Regenerate" button (outline) next to the section title — calls `useRegenerateRebateInsights`.
  - Below insights, if `observations.length > 0`: small grey panel "Observations: …".

**New file:** `components/facility/rebate-optimizer/rebate-insight-card.tsx` — one insight card.

Flag-for-review target: show the flagged count in the section header as a badge, and expose a `<RebateInsightFlagsList>` on the Rebate Optimizer page in a separate "Flagged Follow-ups" section.

### 1.6 Tests

- `lib/ai/__tests__/rebate-optimizer-schemas.test.ts` — Zod shape tests (no API call)
- `lib/actions/__tests__/rebate-optimizer-insights.test.ts` — mocks the Anthropic client; asserts: cache hit returns cached row, `forceFresh` bypasses cache, invalid response throws, `flagRebateInsight` persists.
- Integration test (tagged `@ai`, skipped by default): hits real API on a fixture facility; asserts response validates against schema.

### 1.7 Verify

- `bunx tsc --noEmit` → 0 errors
- Load `/dashboard/rebate-optimizer` with the demo cookie → section appears collapsed → click expand → click Generate → insights render within ~15s → each card has clickable citations + action buttons → Regenerate reuses cache then bypasses on explicit click → Flag for review persists

### 1.8 Commit

`feat(rebate-optimizer): AI-powered Smart Recommendations panel (Tier 1)` — all Wave 1 changes in one commit.

---

## Wave 2 — Tier 4 Renewal Brief (~4h)

### 2.1 Schema

**File:** `lib/ai/renewal-brief-schemas.ts` (new)

```ts
export const renewalBriefAskSchema = z.object({
  rank: z.number().int().min(1),
  ask: z.string(),
  rationale: z.string(),
  quantifiedImpact: z.string().nullable(),
})

export const renewalBriefConcessionSchema = z.object({
  concession: z.string(),
  estimatedCost: z.string().nullable(),
})

export const renewalBriefSchema = z.object({
  contractId: z.string(),
  generatedAt: z.string(),
  executiveSummary: z.string(),
  performanceSummary: z.object({
    termMonths: z.number().int(),
    totalSpend: z.number(),
    projectedFullSpend: z.number(),
    captureRate: z.number().min(0).max(1),
    missedTiers: z.array(
      z.object({
        quarter: z.string(),
        tierMissed: z.number().int(),
        shortfallDollars: z.number(),
        estimatedLostRebate: z.number(),
      })
    ),
  }),
  primaryAsks: z.array(renewalBriefAskSchema).min(1).max(8),
  concessionsOnTable: z.array(renewalBriefConcessionSchema),
})
```

### 2.2 Cache table

Add to `prisma/schema.prisma` (same pattern as RebateInsightCache):

```prisma
model RenewalBriefCache {
  id         String   @id @default(cuid())
  contractId String
  inputHash  String
  response   Json
  model      String
  createdAt  DateTime @default(now())
  expiresAt  DateTime // 1 hour — briefs change less frequently

  contract Contract @relation(fields: [contractId], references: [id], onDelete: Cascade)

  @@index([contractId, expiresAt])
  @@map("renewal_brief_cache")
}
```

`bun run db:push` after.

### 2.3 Server action

**File:** `lib/actions/contracts/renewal-brief.ts` (new, `"use server"`)

- `generateRenewalBrief(contractId: string, opts?: { forceFresh?: boolean })`
- Loads contract + terms + tiers + all `Rebate` rows + `ContractPeriod` rollups + `ContractChangeProposal` history
- Same cache-then-LLM pattern as Tier 1
- Claude model: `claude-opus-4-6`, `thinking: { type: "adaptive" }`, `max_tokens: 12000`

System prompt emphasizes: cite specific quarters, quantify missed tiers, don't invent terms not in the input.

### 2.4 UI

**Modify:** `components/contracts/contract-detail-client.tsx` header action row — add "Generate Renewal Brief" button (only when contract is within 180 days of expiration).

**New file:** `components/contracts/renewal-brief-dialog.tsx`
- shadcn `Dialog` `max-w-3xl`
- Body: renders the renewal brief as rich markdown (`react-markdown` if available, else a simple renderer)
- Footer: `[Copy as Markdown]` button + `[Regenerate]` button + `[Close]`

### 2.5 Tests

- `lib/ai/__tests__/renewal-brief-schemas.test.ts` — Zod shape
- `lib/actions/contracts/__tests__/renewal-brief.test.ts` — mock Anthropic; cache hit, force fresh, Zod validation
- `@ai` integration test (skipped by default)

### 2.6 Verify

- Load a contract near expiration → button visible → click → modal opens → brief streams in ~20-30s → copy-as-markdown produces valid markdown → regenerate bypasses cache

### 2.7 Commit

`feat(contract-detail): AI-generated Renewal Brief modal (Tier 4)`

---

## Verification (post-both-waves)

- `bunx tsc --noEmit` → 0 errors
- `bunx vitest run` → all green (schema + action unit tests; integration tests skipped by default)
- `bun run lint` → 0 errors
- Live smoke on 2 facilities + 3 contracts
- Budget CI check: integration-test dollar total < $0.50/facility and <$1.00/contract
