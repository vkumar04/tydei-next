# Prospective Analysis Rewrite — Design Spec

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement the subsystems below. Each subsystem gets its own per-subsystem TDD plan generated on demand. Steps use checkbox (`- [ ]`) syntax for tracking.

**Date:** 2026-04-18
**Branch:** continue in `contracts-rewrite-00-schema`
**Status:** Design approved by Vick (2026-04-18) via batch approval
**Brainstormed via:** superpowers:brainstorming
**Related specs:**
- Required dependency: `2026-04-18-cog-data-rewrite.md` (current COG prices for variance)
- Required dependency: `2026-04-18-contracts-rewrite.md` (rebate engine)
- Required dependency: `2026-04-18-platform-data-model-reconciliation.md` (vendor resolve for pricing-file variance)
- Optional: `2026-04-18-ai-integration-foundation.md` (PDF extraction for proposals via document indexing)

**Goal:** Rewrite `/dashboard/analysis/prospective` as a **facility-side proposal evaluator**:
- Score incoming vendor proposals from the buyer's perspective (not the vendor's)
- Analyze pricing files line-by-line against current COG for variance + savings potential
- Generate negotiation points + risks based on scoring rules
- Support comparison mode (two proposals side-by-side)

Distinct from `/dashboard/analysis` (capital-contract NPV/IRR) — this page evaluates forward-looking *new* contracts, not depreciation of existing ones.

**Architecture:** Two parallel upload pipelines feeding separate state slots:
1. **PDF proposal** → `AnalyzedProposal` (scored 0-10 across 5 dimensions)
2. **CSV/XLSX pricing file** → `PricingAnalysis` (per-line variance vs COG)

Pure engine modules; no schema changes; client-side form state + server actions for COG aggregation.

**Tech Stack (unchanged):** Next.js 16, Prisma 7, TanStack Query, recharts, Zod, react-dropzone, shadcn/ui.

---

## 1. Scope

### In scope

- **Proposal scoring engine** — `calculateProposalScores(input)` produces 0-10 scores across 5 dimensions with documented formulas (see §2):
  - Cost Savings (30% weight)
  - Price Competitiveness (20%)
  - Rebate Attainability (20%)
  - Lock-In Risk (15%, higher = less risk)
  - Total Cost of Ownership (15%)
- **Recommendation engine** — `generateRecommendation(scores, commitments)` produces negotiation points + risks + `accept / negotiate / decline` verdict
- **Rebate tier generation** — dynamic tiers from commitments
- **Pricing file analysis** — per-line variance against COG; summary stats (itemsWithMatch, avgVariance, potentialSavings)
- **Manual entry mode** — skip upload, fill form directly
- **Comparison mode** — 2 proposals side-by-side with score-bar chart
- **Tabs** — `upload` / `manual` / `proposals` / `pricing` / `compare`
- **State machine** — `idle` / `analyzing` / `complete` / `error`

### Out of scope

- **Real-time PDF OCR for proposals** — simulated delay in v1; real OCR ships with AI agent document indexing spec
- **AI-rewritten negotiation playbook** — rule-based only in v1
- **Auto-send negotiation email** — out of scope; user copies talking points manually
- **Multi-proposal matrix beyond side-by-side** — 2-way compare only
- **Persist analyzed proposals** — session-scoped in v1; "save this analysis" is a future feature
- **Integrations** — no Slack / email notifications on upload

### Non-goals (preserved)

- No new schema. No external API dependencies.

---

## 2. Translation notes — canonical prototype → tydei

| Prototype pattern | Tydei equivalent |
|---|---|
| In-memory `proposals[]` + `pricingAnalyses[]` state | Same — session-scoped state, no persistence |
| Simulated OCR 2500ms delay on PDF | Kept for UX pacing; documented as "simulated — real OCR via doc indexing" |
| Bi-directional substring vendor match | `vendorId` FK + `findVendorByName` cascade from platform-data-model §4.3 |
| `current-spend` lookup from COG | Server action `getCurrentSpendForVendor(vendorId)` aggregating COG |
| `marketBenchmark` fallback to `proposedAnnual * 1.1` | Same fallback; documented as "no external benchmark data" |
| `calculateProposalScores` + `generateRecommendation` | Ported to `lib/prospective-analysis/scoring.ts` + `recommendation.ts` |
| Dynamic rebate tier generation | `lib/prospective-analysis/rebate-tiers.ts` — produces tier structure from minimumSpend + proposed rebate rate |
| Pricing file analysis | Server-side per-line COG lookup via `getCurrentPriceForItem(vendorId, vendorItemNo)` |
| Comparison via `?compare=<proposalId>` URL param | Same pattern |

---

## 3. Data model changes

**None.**

---

## 4. Subsystems — priority-ordered

### Subsystem 0 — Scoring + recommendation engines (P0)

**Priority:** P0.

**Files:**
- Create: `lib/prospective-analysis/scoring.ts`:
  - `calculateProposalScores(input: ProposalInput): ProposalScores`
- Create: `lib/prospective-analysis/recommendation.ts`:
  - `generateRecommendation(scores, commitments): { verdict, negotiationPoints[], risks[] }`
- Create: `lib/prospective-analysis/rebate-tiers.ts`:
  - `generateDynamicRebateTiers(input)` — synthesizes 3-tier structure from baseline + proposed rate
- Create: `lib/prospective-analysis/__tests__/` — one test per formula + worked examples from canonical §3-4

**Scoring formulas** (canonical §3, verbatim):

```
costSavingsScore         = clamp(savingsPercent / 2, 0, 10)
priceCompetitivenessScore = clamp(5 + priceVsMarket / 4, 0, 10)
rebateAttainabilityScore  = clamp((currentSpend / minimumSpend) * 5, 0, 10)
lockInRiskScore           = max(0, 10 - lockInPenalty)
                          // penalties: years>3:-2, exclusivity:-3, share>70%:-2, min>0.8*total:-2
tcoScore                  = min(10, 6 + priceProtection:2 + net60/90:1 + volumeDisc>5%:1)

overall = 0.30*costSavings + 0.20*priceCompetitive + 0.20*rebateAttain +
          0.15*lockInRisk + 0.15*tco
```

**Verdict** (canonical §4.3):
- `overall >= 7.5` → `accept`
- `overall >= 5` → `negotiate`
- `else` → `decline`

**Acceptance:**
- All tests green against worked examples.
- Overall = exact weighted sum of component scores.
- Verdict thresholds locked in.

**Plan detail:** On-demand — `00-engines-plan.md`.

---

### Subsystem 1 — Proposal upload + PDF extraction (P1)

**Priority:** P1.

**Files:**
- Create: `components/facility/analysis/prospective/upload-proposal-tab.tsx` — PDF dropzone
- Create: `lib/actions/prospective-analysis.ts::analyzeProposal(file)` — extracts or simulates; returns `AnalyzedProposal`
- Wire: auto-pull `currentSpend` from COG for the extracted vendor
- Wire: call scoring + recommendation engines

**Acceptance:**
- Drop PDF → within 2.5s see scored proposal render.
- Scores display as 5-bar chart + overall big number + verdict badge.
- Negotiation points + risks render as checklist.

**Plan detail:** On-demand — `01-proposal-upload-plan.md`.

---

### Subsystem 2 — Pricing file upload + variance analysis (P1)

**Priority:** P1.

**Files:**
- Create: `components/facility/analysis/prospective/upload-pricing-tab.tsx` — CSV/XLSX dropzone
- Create: `lib/actions/prospective-analysis.ts::analyzePricingFile(file, vendorId)`:
  - Parse rows
  - Per item: look up current COG price via `getCurrentPriceForItem`
  - Compute variance %, savingsOpportunity
  - Build summary stats

**Per-line shape:**

```ts
{
  itemNumber, description, proposedPrice,
  currentPrice?,     // from COG
  variance?,         // (proposed - current) / current * 100
  savingsOpportunity? // if negative variance: (current - proposed) × estimatedQty
}
```

**Summary stats:**
- `totalItems`, `itemsWithCOGMatch`, `avgVariance`
- `totalProposedSpend`, `totalCurrentSpend`, `potentialSavings`
- `itemsBelowCOG` (proposed cheaper than current), `itemsAboveCOG` (proposed more expensive)

**Acceptance:**
- CSV upload produces per-line analysis in <5s for 1000-row file.
- Summary stats correct; tested on synthetic data.
- Items without COG match flagged.

**Plan detail:** On-demand — `02-pricing-file-plan.md`.

---

### Subsystem 3 — Manual entry mode (P1)

**Priority:** P1.

**Files:**
- Create: `components/facility/analysis/prospective/manual-entry-tab.tsx` — form inputs for all proposal fields
- On submit: calls same scoring engine as upload path

**Acceptance:**
- User can enter values + see scored proposal without uploading a file.
- Same scoring output path.

**Plan detail:** On-demand — `03-manual-entry-plan.md`.

---

### Subsystem 4 — Comparison mode (P1)

**Priority:** P1.

**Files:**
- Modify: `app/dashboard/analysis/prospective/page.tsx` — reads `?compare=<proposalId>` URL param
- Create: `components/facility/analysis/prospective/comparison-tab.tsx` — 2-proposal side-by-side
- Create: `components/facility/analysis/prospective/score-comparison-chart.tsx` — grouped bar chart of 5 scores

**Acceptance:**
- Select 2 proposals → side-by-side scores, recommendation, savings comparison.
- Exports comparison to CSV.

**Plan detail:** On-demand — `04-compare-plan.md`.

---

### Subsystem 5 — State machine + tab orchestrator (P1)

**Priority:** P1.

**Files:**
- Modify: `components/facility/analysis/prospective-client.tsx` (existing, 833 lines — ⚠️ mega-file) — refactor:
  - Split into `prospective-client.tsx` (orchestrator, ≤200 lines)
  - `prospective-tabs.tsx` (tab router)
  - `prospective-state.tsx` (xstate-style state machine for analysis lifecycle)
  - Each tab becomes its own component (subsystems 1-4)
- State machine: `idle` → `analyzing` → `complete` / `error`

**Acceptance:**
- No functional regression.
- `prospective-client.tsx` ≤200 lines.
- State transitions correct; no stuck-in-analyzing states.

**Plan detail:** On-demand — `05-state-split-plan.md`.

---

### Subsystem 6 — UI polish (P2)

Standard polish — empty states, a11y, responsive, hydration.

**Plan detail:** On-demand — `06-ui-polish-plan.md`.

---

### Subsystem 7 — PDF contract clause analyzer (P1)

**Priority:** P1 — sourced from Charles's `analyzePDFContract` engine. New territory not covered in subsystems 0-6 (which evaluate proposals as scored line-items, not clause-by-clause legal review).

**Context:** Charles shared a complete `analyzePDFContract(pdfText)` engine that:
- Matches text against a library of 20+ clause categories (auto-renewal, termination, price protection, minimum commitment, exclusivity, payment terms, rebate structure, audit rights, indemnification, governing law, dispute resolution, assignment, force majeure, confidentiality, warranty, limitation of liability, IP ownership, most-favored-nation, volume commitment, co-op marketing, data rights, insurance, compliance reps, non-solicitation, GPO affiliation)
- Scores each clause on (a) presence, (b) risk level (low / medium / high), (c) favor-ability (facility-friendly / neutral / vendor-friendly)
- Emits a structured risk report + recommended re-negotiation language

**Files:**
- Create: `lib/prospective-analysis/clause-library.ts` — the 20+ clause-category patterns + detection regex/keywords + risk annotations (ports Charles's library verbatim)
- Create: `lib/prospective-analysis/pdf-clause-analyzer.ts`:
  - `analyzePDFContract(pdfText: string): ClauseAnalysis`
  - Uses clause library + matches text segments → produces `ClauseFinding[]` per category
  - Per finding: `{ category, found, quote?, riskLevel, favorability, recommendedAction? }`
  - Missing-clause flags: high-risk categories that SHOULD be present but aren't (e.g., termination-for-convenience, audit-rights)
- Create: `lib/prospective-analysis/__tests__/pdf-clause-analyzer.test.ts` — coverage for every clause category with Charles's worked examples
- Create: `components/facility/analysis/prospective/pdf-clause-tab.tsx` — render findings as a 3-column table (category / risk-badge / quote) + missing-clauses alert panel + export-as-markdown button
- Wire: available as a new sub-tab under "Proposal Upload" (the PDF already uploaded in subsystem 1)

**Integration with AI:**
- First pass is deterministic (regex + keyword matching)
- Optional Claude fallback (`ai-integration-foundation` feature): for clauses where regex is ambiguous (confidence < 0.8), run a single Claude call that returns `{ found, quote, reasoning }` — user confirms pair-wise before the finding is committed
- NEVER auto-mark a clause as "high risk" without a matched quote — user always sees the source text

**Return shape:**
```ts
type ClauseFinding = {
  category: ClauseCategory          // 25+ enum values
  found: boolean
  quote: string | null              // the matched text segment
  riskLevel: "low" | "medium" | "high"
  favorability: "facility" | "neutral" | "vendor"
  recommendedAction: string | null  // from Charles's risk library
}

type ClauseAnalysis = {
  findings: ClauseFinding[]
  missingHighRiskCategories: ClauseCategory[]
  overallRiskScore: number          // 0-10, aggregated from high-risk findings
  summary: string                   // human-readable headline
}
```

**Cross-cutting reference:**
- Contracts-list-closure spec §4.5 (compare cards) — when a clause analysis has been run, the "Contract Terms" compare card renders the top-3 risks as chip badges for quick comparison between 2 proposals.
- Financial-analysis-rewrite spec — when a capital contract is analyzed, the termination + assignment clauses feed into the NPV adjustment (early termination penalty raises risk discount).

**Acceptance:**
- PDF → within 3s produces finding for every clause category in the library.
- Missing high-risk categories surface prominently.
- Claude fallback fires only when regex is ambiguous.
- Export to markdown renders a legal-readable risk report.
- Charles's worked examples green as fixture tests.

**Plan detail:** On-demand — `07-pdf-clause-analyzer-plan.md`.

---

### Subsystem 8 — COG spend-pattern analyzer (P2)

**Priority:** P2 — sourced from Charles's `analyzeCOGSpendPatterns` engine.

**Goal:** When a proposal arrives for a vendor the facility already buys from, pull the vendor's last-12-months COG spend and analyze patterns:
- Seasonal variation (if >20% monthly stdev, flag for buffer stock)
- Top-5 items by spend (focus negotiation on these)
- Price drift vs pricing-file (if COG avg > 5% above pricing-file, flag for review)
- Vendor market share of category (if >40%, tie-in risk)

**Files:**
- Create: `lib/prospective-analysis/cog-spend-analyzer.ts`:
  - `analyzeCOGSpendPatterns(vendorId, months?: 12): SpendPatternAnalysis`
  - Server action wrapper in `lib/actions/prospective-analysis.ts`
- Create: `lib/prospective-analysis/__tests__/cog-spend-analyzer.test.ts`
- Wire: shown as a sidebar card alongside the scored proposal (subsystem 1)

**Return shape:**
```ts
type SpendPatternAnalysis = {
  vendorId: string
  totalSpend12Mo: number
  monthlyStdevPct: number
  seasonalityFlag: boolean
  top5ItemsBySpend: Array<{ vendorItemNo: string; description: string; spend: number }>
  priceDriftVsPricingFile: number  // % — positive means COG is above pricing-file
  categoryMarketShare: number       // 0-1
  tieInRiskFlag: boolean            // true if marketShare > 0.4
}
```

**Acceptance:**
- 12-month COG pull in <1s for demo scale.
- Seasonality + drift + tie-in flags surface correctly on worked fixtures.

**Plan detail:** On-demand — `08-cog-spend-analyzer-plan.md`.

---

## 5. Execution model

```
Subsystem 0 (engines)
  ↓                     ↘                           ↘
Subsystem 1 (proposal)  Subsystem 2 (pricing file)  Subsystem 3 (manual)
  ↓                      ↓                           ↓
         Subsystem 4 (comparison)
                ↓
         Subsystem 5 (state machine + split)
                ↓
         Subsystem 6 (UI polish)

        ── separate track (can run in parallel) ──
Subsystem 7 (PDF clause analyzer)
Subsystem 8 (COG spend-pattern analyzer — depends on cog-data-rewrite subsystem 0+1)
```

**Canonical reference:** Charles's Prospective Contract Analysis Engine
(vendor/facility/PDF/pricing-file/COG sub-engines) is the authoritative
reference implementation for subsystems 0, 2, 7, and 8. Scoring formulas
in subsystem 0 match Charles's verbatim; the PDF clause library in
subsystem 7 ports Charles's 20+ clause categories + risk annotations
directly.

**Global verification:**
```bash
bunx tsc --noEmit
bun run test
bun run test lib/prospective-analysis/__tests__/
```

---

## 6. Acceptance

- All 9 subsystems merged.
- Scoring formulas match Charles's engine + canonical doc exactly; worked examples green.
- Pricing file produces variance + summary; matches expected shape.
- PDF clause analyzer covers all 25+ categories; missing-high-risk flags work.
- COG spend-pattern analyzer emits seasonality/drift/tie-in flags correctly.
- Comparison mode works end-to-end.
- `prospective-client.tsx` ≤200 lines.
- `bunx tsc --noEmit` → 0.

---

## 7. Known risks

1. **Score calibration.** Formulas come from the prototype; real-world proposals may cluster around certain scores more than expected. Monitor post-ship; adjust weights/thresholds in v2.
2. **Market benchmark absence.** No external data source for "fair market pricing." Fallback `benchmark = proposedAnnual * 1.1` is a placeholder; tooltip explains the assumption.
3. **Manual entry drift.** Users fill in invented numbers → garbage-in-garbage-out. Acceptable; this is a decision-support tool, not an oracle.
4. **Prospective client file split.** 833 lines to refactor. Mitigation: subsystem 5 is a single commit with smoke-test across all tabs + paths.
5. **Pricing-file parser failure modes.** Arbitrary user CSVs; expect column-mapping issues. Mitigation: use AI column-mapping assist from AI foundation when auto-detect is unsure.

---

## 8. Out of scope (explicit)

- Real-time PDF OCR (comes with AI agent doc indexing)
- AI-rewritten negotiation playbook
- Auto-send negotiation emails
- Proposal persistence / saved analyses
- Multi-proposal matrix (N > 2)

---

## 9. How to iterate

1. Start with subsystem 0.
2. Generate per-subsystem plan via superpowers:writing-plans.
3. Execute; commit each separately.
4. Verify; merge; proceed.
