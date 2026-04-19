# Rebate Optimizer — AI-Powered Enhancement Design

**Date:** 2026-04-19
**Status:** Design for approval
**Author:** superpowers (brainstorming)
**Triggered by:** Charles — "how can we use claude to make it better the api i mean"

---

## 1. Context

### What exists today
The Rebate Optimizer (`/dashboard/rebate-optimizer`) has a complete rule-based engine:
- `lib/rebate-optimizer/engine.ts` — ranks opportunities by ROI, computes tier gaps
- `lib/rebate-optimizer/alert-generator.ts` — 4 alert kinds (at/approaching/missed/achieved tier)
- Scenario builder + sensitivity chart + compare-scenarios table (UI components)

### What Claude is already used for (existing patterns to follow)
- `app/api/ai/extract-contract/route.ts` — PDF → structured `extractedContractSchema` via Messages API
- `lib/ai/schemas.ts::dealScoreSchema` — 6-dimension contract scoring (shipped R5.33)
- `app/api/contracts/[id]/score/export/route.ts` — AI recommendations CSV export (shipped R5.15)
- `lib/ai/contract-extract-mapper.ts` — domain-specific extract helpers
- `lib/cog/ai-dedup.ts` — fuzzy duplicate detection for COG

### Gap being addressed
The rule-based engine ranks single contracts. Claude lets us:
1. Add narrative *reasoning* to the rankings ("why this contract, why now, what trade-off")
2. Think across multiple contracts at once (portfolio reallocation)
3. Answer free-form "what if" questions with real computed numbers
4. Produce high-leverage one-off artifacts (renewal briefings)

---

## 2. Four capability tiers

### Tier 1 — Structured AI Recommendations (ship first)

Takes the engine's ranked opportunities + alerts + recent spend → returns narrative recommendations as Zod-validated JSON. Rendered as a panel next to the rule-based alerts.

**Example output (1 of N):**
> **Stryker Joint Replacement — $180K to Tier 3 with 47 days left**
> Averaging $62K/week — on track for 86% of threshold. DePuy Synthes has $210K of discretionary hip spend this quarter with no active contract. Redirecting 30% ($63K) clears Tier 3, unlocking **$22,400** additional rebate. No penalty on DePuy side (flat price). Flag for Nov purchasing review.
>
> *Impact:* +$22,400 · *Confidence:* high · *Action:* `redirect_spend`

### Tier 2 — Cross-Contract Arbitrage

Same pattern, but the prompt gets the *whole portfolio* and Claude tool-calls `runScenario`, `compareTiers`, `listContracts` to explore reallocations humans couldn't enumerate.

**Example:**
> Your Medtronic cardiac line exceeded top-tier by $340K (flat after $1M). Smith & Nephew sports is $185K below Tier 2. Both have overlapping arthroscopy SKUs. Dec shift of $185K from Medtronic → Smith & Nephew loses $0 at source, gains $7,400 at destination.

### Tier 3 — Conversational What-If

Free-form question field, Claude streams answer with tool calls.

**Example:**
> **User:** "What if I extend the Arthrex contract by 12 months with a 2pt better tier 1 rate?"
> **Claude:** computes via tools, returns narrative + numbers.

### Tier 4 — Pre-Renewal Briefing (ship second — highest leverage per call)

Per-contract button. Claude reads contract + amendments + every earned/missed rebate + vendor comparison → 1-page negotiation primer.

**Example output (abbreviated):**
> **Arthrex Arthroscopy — renewal due Jul 2026**
> - 24-mo term: $3.2M/$3.8M spend captured; Tier 3 missed once in Q2 2025 (fell $58K short)
> - Cumulative earned: $94K/$156K possible (60%)
>
> **Primary asks**
> 1. Lower Tier 3 threshold by 10% — would have captured Tier 3 in 8/8 quarters (+$62K retroactively estimated)
> 2. Add marginal rebate on Tier 2→3
> 3. Price lock on top 20 SKUs
>
> **Concessions if needed**
> - Extend term to 3 years
> - 1% annual escalator (~$32K over 3 years)

---

## 3. Recommended scope for this spec

**Ship Tier 1 + Tier 4.** Defer Tier 2 + Tier 3 until Tier 1 is in production and we know whether users actually engage with AI outputs. Rationale:

- **Tier 1** — fastest route to a visibly-AI-powered optimizer. Follows the existing `dealScoreSchema` pattern exactly. Low risk.
- **Tier 4** — highest value per call (a negotiation brief is the kind of thing a facility would pay for). Single-contract scope = simpler prompting and easier evaluation than Tier 2.
- **Tier 2** — worth it once Tier 1 is live, but tool-call orchestration is more code + harder to evaluate correctness.
- **Tier 3** — a "cool" conversational feature but competes with the existing scenario builder UI. Defer.

---

## 4. Architecture (for Tier 1 + Tier 4)

### 4.1 Tier 1 — Smart Recommendations

**Server action:** `lib/actions/rebate-optimizer-insights.ts::getRebateOptimizerInsights(facilityId, opts?)`

Flow:
1. Load opportunities (existing `getRebateOpportunitiesEngine`)
2. Load alerts (existing `generateRebateAlerts`)
3. Load last 90 days of per-vendor spend (new read — small query)
4. Build a system prompt (cached via `cache_control: {type: "ephemeral"}`)
5. Call `client.messages.parse()` against a Zod response schema (Opus 4.6 + adaptive thinking)
6. Validate, serialize, return

**Response schema (new file `lib/ai/rebate-optimizer-schemas.ts`):**
```ts
export const rebateInsightSchema = z.object({
  id: z.string(),           // stable slug for the recommendation
  rank: z.number().int(),    // 1 = most actionable
  title: z.string(),         // headline, ≤80 chars
  summary: z.string(),       // 1-2 sentence pitch
  rationale: z.string(),     // 3-6 sentence reasoning w/ numbers
  impactDollars: z.number().nullable(),
  confidence: z.enum(["low", "medium", "high"]),
  actionType: z.enum([
    "redirect_spend",
    "accelerate_purchase",
    "negotiate_tier",
    "log_collection",
    "review_compliance",
  ]),
  citedContractIds: z.array(z.string()),  // anchors for the UI to link back
})

export const rebateInsightsResponseSchema = z.object({
  facilityId: z.string(),
  generatedAt: z.string(),                 // ISO timestamp
  insights: z.array(rebateInsightSchema),
  // If Claude surfaces anything worth flagging beyond actionable items:
  observations: z.array(z.string()).optional(),
})
```

**Model + thinking:** `claude-opus-4-6`, `thinking: {type: "adaptive"}`. Portfolio reasoning genuinely benefits from extended thinking.

**Streaming:** yes — `client.messages.stream`. The UI renders a skeleton → populates insights as they decode. Matches the UX of the existing contract-extract dialog.

**Prompt caching:** the system prompt describing the rebate-optimizer schema + CLAUDE.md conventions is static → wrap it in `cache_control: {type: "ephemeral"}`. ~80% cost reduction on regenerations.

**UI:** new panel inside `components/facility/rebate-optimizer/optimizer-client.tsx` — "Smart Recommendations (AI)", collapsed by default with a "Generate" button. Lives next to the existing Quick Win alert.

### 4.2 Tier 4 — Renewal Briefing

**Server action:** `lib/actions/contracts/renewal-brief.ts::generateRenewalBrief(contractId)`

Inputs:
- Contract + all terms + all tiers
- All historical `Rebate` rows (to compute capture rate + missed-tier history)
- All `ContractPeriod` rollups
- All `ContractChangeProposal` history (amendment context)

Response schema (new):
```ts
export const renewalBriefSchema = z.object({
  contractId: z.string(),
  generatedAt: z.string(),
  executiveSummary: z.string(),      // 2-3 sentences
  performanceSummary: z.object({
    termMonths: z.number().int(),
    totalSpend: z.number(),
    projectedFullSpend: z.number(),
    captureRate: z.number(),         // earned / possible, 0-1
    missedTiers: z.array(z.object({
      quarter: z.string(),
      tierMissed: z.number().int(),
      shortfallDollars: z.number(),
      estimatedLostRebate: z.number(),
    })),
  }),
  primaryAsks: z.array(z.object({
    rank: z.number().int(),
    ask: z.string(),                 // headline
    rationale: z.string(),
    quantifiedImpact: z.string().nullable(),
  })),
  concessionsOnTable: z.array(z.object({
    concession: z.string(),
    estimatedCost: z.string().nullable(),
  })),
})
```

**Surface:** button on `/dashboard/contracts/[id]/edit` or the detail header — "Generate Renewal Brief". Output renders in a modal; export-to-PDF is a nice-to-have follow-up.

**Model:** same (`claude-opus-4-6` + adaptive thinking). Likely longer thinking budget since the prompt includes more history per contract.

---

## 5. Data flow

```
┌──────────────────┐
│ User clicks      │
│ "Generate        │
│  Recommendations"│
└─────────┬────────┘
          │
          ▼
┌───────────────────────────────────┐
│ getRebateOptimizerInsights(fid)   │
│                                   │
│  1. opps = getRebateOpportunities │
│  2. alerts = generateRebateAlerts │
│  3. spend = last-90d vendor spend │
│  4. ctx = buildContext(1,2,3)     │
│  5. messages.stream({             │
│       model: claude-opus-4-6,     │
│       thinking: {type:"adaptive"},│
│       response_format: insights,  │
│       cache_control: {ephemeral}, │
│     })                            │
│  6. validate via Zod              │
│  7. return { insights }           │
└─────────┬─────────────────────────┘
          │ stream of partial insights
          ▼
┌───────────────────────────────────┐
│ UI panel renders progressively:   │
│  - skeleton on load               │
│  - each insight card animates in  │
│  - action buttons on each card    │
│    (e.g., "Open in Scenario       │
│     Builder", "Flag for review")  │
└───────────────────────────────────┘
```

---

## 6. Testing strategy

- **Unit (deterministic):** `lib/ai/__tests__/rebate-optimizer-schemas.test.ts` — asserts Zod schemas accept/reject expected shapes; doesn't call Claude.
- **Integration (non-deterministic, tagged `@ai`):** one test hits the real API with a known fixture facility + asserts the response validates against the schema. Skipped by default; runnable with `vitest run --include '**/@ai/**'`. Uses a fixed-seed prompt where possible.
- **Snapshot of prompt structure:** lock the system prompt template so prompt regressions are visible in PRs.
- **Cost budget check:** CI step that totals `usage.input_tokens + output_tokens × rate` for integration runs. Fail if > $0.50 per facility.

---

## 7. Cost + latency

Per `getRebateOptimizerInsights` call:
- Input: ~3-5K tokens (opps + alerts + spend context) → **$0.015 – $0.025** at Opus 4.6 rates, **$0.003 – $0.005 cached**
- Output: ~1-2K tokens + ~2-4K thinking → **$0.025 – $0.075**
- Total **$0.04 – $0.10 cold · $0.03 – $0.08 cached**
- Latency: **5-15 seconds** (streamed)

Per `generateRenewalBrief` call (longer context + longer thinking):
- **$0.15 – $0.40** per call
- Latency: **15-40 seconds**

Both are user-triggered (no background jobs). Cost scales with engagement, not facility count.

---

## 8. Risks + mitigations

| Risk | Mitigation |
|---|---|
| Claude hallucinates dollar figures | Always cite `contractId`s; UI links back to the contract + shows a "verify math" button that reruns the engine-side calc on-the-fly |
| Rate limits at scale | Cache per-facility insights for 15 min; "regenerate" button bypasses cache |
| Users treat AI output as authoritative | Every recommendation card shows confidence + a "how was this computed" tooltip with the engine-side numbers Claude saw |
| Prompt drift over Claude model updates | Snapshot test the prompt + freeze model ID at `claude-opus-4-6` (upgrade intentionally, not implicitly) |
| PII / vendor data leakage | Claude API call stays server-side; response doesn't expose raw spend data to the client beyond what the UI already shows |

---

## 9. Out of scope for this spec

- Tier 2 (cross-contract arbitrage with tool calls) — defer
- Tier 3 (conversational Q&A) — defer
- PDF export of renewal briefs — follow-up once Tier 4 is live
- Background generation / scheduled insights — explicitly user-triggered only
- Multi-facility rollup — single-facility per call; a parent-org dashboard is separate work

---

## 10. Open questions for Charles

1. **Surface placement for Tier 1:** next to "Quick Win" alert, or a new full-width section above the KPI cards?
2. **Regeneration UX:** 15-minute cache then regen button, or always fresh on click?
3. **Tier 4 surface:** modal on contract detail or a dedicated "Renewal Briefs" page?
4. **Action buttons on insight cards:** "Open in Scenario Builder" + "Flag for review" as a starter set — any others you want wired?
5. **PDF export for renewal brief:** in scope for v1 or follow-up?

---

## Ship order (assuming approval)

1. Tier 1 plumbing + schemas + server action + streaming UI panel — **~3h**
2. Tier 1 prompt engineering + snapshot tests + cost budget CI check — **~1h**
3. Tier 4 renewal brief action + modal UI — **~3h**
4. Tier 4 prompt engineering + fixture-based integration test — **~1h**

**Total ~8h for Tier 1 + Tier 4.** Ship in order (Tier 1 first, verify live, then Tier 4).
