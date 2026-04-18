# AI Integration Foundation — Design Spec

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement the subsystems below. Each subsystem gets its own per-subsystem TDD plan generated on demand. Steps in those plans use checkbox (`- [ ]`) syntax for tracking.

**Date:** 2026-04-18
**Branch:** `ai-foundation` (create via worktree before execution, or continue in existing `contracts-rewrite-00-schema`)
**Status:** Design approved by Vick (2026-04-18). Four architectural decisions locked in:

1. **Pure advisory mode** — Claude proposes; user confirms. No silent auto-apply. Re-visit as "D: tiered auto-apply" in a v2 once we have usage data.
2. **Hand-holding pattern** — Claude does fuzzy matching + reasoning up-front so pair-wise user validation takes ~2s per decision, not minutes.
3. **Claude via `@ai-sdk/anthropic`** — already wired (`lib/ai/config.ts` exports `claudeModel = anthropic("claude-opus-4-6")`). No new provider code.
4. **Bounded scope** — AI plugs into upload assist, dedup, quality narrative, and match-status explanation only. Broader Claude features (renewal briefs, tier advisors, true-margin narratives) are parked for a follow-up until we've shipped a page-by-page rewrite.

**Related specs:**
- Contracts rewrite (shipped) — provides `computeRebateFromPrismaTiers` and the contract calculation engines Claude narrates over
- Dashboard rewrite (parked) — separate; no AI integration in this pass
- Renewals rewrite (parked) — rule-based `generateNegotiationPoints` stays; Claude versions deferred
- Writing next: platform data-model reconciliation → COG data rewrite → contracts list closure → data pipeline. Specs 3 and 5 depend on this foundation.

**Goal:** Establish the cross-cutting primitives every bounded AI integration across the platform shares — so per-page specs stay thin and consistent. Lock in the UX pattern (Claude proposes with reasoning; user confirms pair-wise) as a single decision that carries across every feature. Split the 984-line `ai-agent-client.tsx` while we're here.

**Architecture:** Vercel AI SDK (`streamText`, `generateObject`, `@ai-sdk/react`) with the `@ai-sdk/anthropic` provider already wired. No server-side orchestration yet — every AI call is a server action invoked from the client, returns a typed structured-output proposal, and renders into a shared review UI. Prompt caching is non-negotiable (prefix match invariant, see §prompt-caching). Credits and rate limits reuse the existing `AICredit` / `rateLimit` infrastructure.

**Tech Stack (unchanged):** Next.js 16, Prisma 7, `@ai-sdk/anthropic` 3.0.71, `ai` 6.0.168, Zod 4, TanStack Query, shadcn/ui. Claude Opus 4.6 default for reasoning-heavy tasks; Claude Haiku 4.5 for mechanical tasks (column-map detection, alias suggestions). Both already exposed from `lib/ai/config.ts`.

---

## 1. Scope

### In scope

- **Shared primitives** — every bounded AI feature pulls from a common context-pack pattern, structured-output helpers, review UI, and audit trail.
- **Claude model routing** — rules for when to use Opus 4.6 vs Haiku 4.5 vs Sonnet 4.6.
- **Seven bounded AI integration points** (enumerated in §3). Each one is specified *here* at the interface level; full implementation lives in the spec that owns the page it renders on.
- **Tech debt retire:** split `components/facility/ai-agent-client.tsx` (984 lines) into focused files. Audit and refactor `lib/ai/tools.ts`, `lib/ai/prompts.ts`, `lib/ai/schemas.ts` while we're in the files.

### Out of scope

- **Broader narrative AI** — renewal briefs, tier advisors, true-margin narratives, renewal negotiation prep, cross-contract natural-language queries beyond the ones already wired. Deferred to a full AI layer spec after per-page rewrites complete.
- **Background/batch AI jobs** — every Claude call in this rewrite is user-initiated and synchronous (with streaming). No cron, no queues.
- **Memory / persistent conversation history** — out of scope. Every AI request stands alone.
- **Managed Agents / Claude containers** — not this pass.
- **Tiered auto-apply (option D)** — explicitly parked. V1 is advisory.
- **Model swaps mid-session** — one model per user action. No Haiku→Opus escalation inside a single request.

### Non-goals (preserved)

- No replacement of the deterministic engines. Claude never computes numbers. Rebate, compliance, variance, margin math stay in `lib/contracts/*` and `lib/rebates/*`.
- No state changes without user confirmation. Every AI-proposed mutation routes through a review surface and an explicit "Apply" click.
- No new schemas beyond what's needed for the audit trail (§2.4).

---

## 2. Shared primitives

### 2.1 Context pack pattern

Every AI feature needs a consistent slice of data passed to Claude. Shape:

```
type AIContextPack = {
  kind: "column_map" | "vendor_dedup" | "item_dedup" | "facility_dedup"
      | "division_infer" | "quality_narrate" | "match_status_explain"
  facilityId: string           // scope filter for all lookups
  userId: string               // for audit + credit
  payload: unknown             // kind-specific; typed per feature
}
```

Every feature exports a `build<Kind>ContextPack(...)` helper that assembles the payload. The pack is **assembled server-side** from Prisma + engine outputs, never trusts raw client input for anything load-bearing.

Why this matters: prompt caching. The static parts of every pack (facility metadata, vendor registry snapshot, alias map) sit in a cached prefix; only the volatile payload differs per request. See §2.3.

**File:** `lib/ai/context-pack.ts` — exports `AIContextPack`, `buildContextPack(kind, facilityId, payload)`.

### 2.2 Structured outputs (Zod-backed)

Every Claude call in this spec returns a typed proposal, never free-text. Pattern per feature:

```
// lib/ai/schemas/vendor-dedup.ts
export const vendorDedupProposalSchema = z.object({
  candidates: z.array(z.object({
    newVendorName: z.string(),
    existingVendorId: z.string(),
    existingVendorName: z.string(),
    confidence: z.number().min(0).max(1),
    similarityMethod: z.enum([
      "exact_alias", "levenshtein", "phonetic", "typo_pattern",
      "truncation", "no_match"
    ]),
    reasoning: z.string().max(500),
  })),
})

export type VendorDedupProposal = z.infer<typeof vendorDedupProposalSchema>
```

Call site uses `client.messages.parse({...}, { output_config: { format: zodOutputFormat(schema) } })`. Parse failures render as `"Claude returned malformed output — please re-run"` toast + logged to audit, not a silent error.

**File:** `lib/ai/schemas/*.ts` — one file per proposal type.

### 2.3 Prompt caching strategy

Anthropic's prompt cache is a prefix match. Every byte in the prefix must be stable across requests. Standard breakdown per call:

```
[ tools block (static, ordered) ]                       ← cached
[ system prompt (static per-kind) ]                     ← cached
[ static context (alias map, column-name patterns,      ← cached
  facility registry snapshot) ]
[ cache_control breakpoint ]
[ volatile per-request payload (the specific rows /     ← uncached
  vendor names to resolve) ]
[ user instruction ]
```

Rules locked in:
- **Never interpolate `Date.now()` or request IDs into the system prompt.**
- **Tool list is deterministic** — same tools in same order for every call of a given kind.
- **Alias map is serialized with stable key ordering** (`JSON.stringify(aliasMap, Object.keys(aliasMap).sort())`).
- **Facility registry snapshot** passed as `{ id, name, normalized }[]` sorted by id.
- **Verification:** each feature has a test asserting `cache_read_input_tokens > 0` on the second identical-prefix request.

**Expected hit rate target:** ≥80% input tokens on cache read after the first request of a session. Below that → audit the prefix for silent invalidators (see `shared/prompt-caching.md` from the claude-api skill).

### 2.4 Audit trail

Every AI call logs to the existing `AuditLog` model with:

- `entityType: "ai_proposal"`
- `entityId`: the feature's proposal ID
- `action`: `"proposed"` | `"accepted"` | `"rejected"` | `"skipped"`
- `userId`, `userRole`
- `metadata`: `{ kind, confidence, inputHash, outputHash, modelId, inputTokens, outputTokens, cacheReadTokens, latencyMs }`

Two reasons this matters:

1. **Trust trajectory.** We ship advisory-only today. The audit log is the dataset we'll use to decide whether to graduate specific proposal types to toast-with-undo or silent auto in a v2.
2. **Debug + cost review.** Claude cost is already metered via `AICredit`, but the audit trail gives us per-proposal-type breakdowns so we know which features earn their keep.

No new schema — `AuditLog` already exists. Just populate it consistently via a helper `logAIProposal(...)` in `lib/ai/audit.ts`.

### 2.5 Credits + rate limiting

The existing `AICredit` + `rateLimit` infrastructure handles cost control. Extensions this spec adds:

- **Per-kind credit cost** — one new enum variant per AI feature (e.g. `vendor_dedup_per_100`, `quality_narrative`) added to `AICredit.AIAction`. Costs are calibrated from a dev-mode run that logs actual token usage; set once, adjust post-ship based on audit-log data.
- **Soft-fail on insufficient credits** — the feature renders a "AI credits exhausted — upgrade or retry later" banner and falls back to the deterministic-only path (e.g. dedup runs the hardcoded alias map without Claude's fuzzy match).
- **Rate limit** — 20 requests/min/user for all AI actions combined (reuses existing limit).

### 2.6 Error handling

Every AI server action uses typed Anthropic SDK exceptions:

| Error | UX |
|---|---|
| `AuthenticationError` (401) | Admin banner: "AI integration misconfigured — contact support." No user-level fallback. |
| `RateLimitError` (429) | Retry-after toast + auto-retry once on the client. Second failure = user-level retry button. |
| `APIError` (any 5xx) | "AI is temporarily unavailable — using exact-match only" — deterministic fallback kicks in. |
| Malformed structured output | "Claude returned an invalid response — retry" button. Audit-logged. |
| Timeout (>30s) | Client cancels, shows retry. |

Error handling lives in `lib/ai/errors.ts` as a shared wrapper used by every AI server action.

### 2.7 The review surface pattern

Every AI proposal in this spec renders into a **shared review UI component**:

```
components/shared/ai/
  ai-review-card.tsx         — single proposal: side-by-side, reasoning, Same/Different/Skip
  ai-review-panel.tsx        — scrollable list of cards; "Next" navigation; progress bar
  ai-review-empty.tsx        — "no ambiguous cases — everything matched deterministically"
  ai-review-exhausted.tsx    — insufficient credits fallback
```

**Pair-wise confirmation shape (`AiReviewCard` props):**

```
type AiReviewCardProps = {
  kind: AIProposalKind
  proposal: {
    id: string
    left:  { title: string; details: Array<[label: string, value: string]> }
    right: { title: string; details: Array<[label: string, value: string]> }
    reasoning: string
    confidence: number
    similarityMethod: string  // surfaced as a small chip
  }
  onDecision: (decision: "same" | "different" | "skip") => void
}
```

Each card shows the two entities side-by-side, Claude's reasoning below, and three buttons. User clicks one. Next card loads. Progress shown as `12 / 30`.

**Bulk skip** is allowed (`Skip All Remaining`) but applies only forward — prior decisions stand.

**Keyboard shortcuts** on each card: `S` = Same, `D` = Different, `Space` = Skip, `Backspace` = back to previous card. Expert users can blaze through.

---

## 3. Seven bounded AI integration points

Each one is specified here at the interface level: what the feature does, which context-pack kind it uses, which proposal schema it returns, where the review UI renders. Full behavior (DB writes, state changes, undo, edge cases) lives in the spec that owns the page.

| # | Feature | Context-pack kind | Renders on | Owning spec |
|---|---|---|---|---|
| 1 | CSV column-mapping assist | `column_map` | COG / pricing / invoice / case-costing import dialogs | COG rewrite + data pipeline |
| 2 | Vendor dedup advisor (fuzzy similarity) | `vendor_dedup` | COG / pricing import dialog | COG rewrite |
| 3 | Item dedup advisor (inventory# / vendorItemNo matching) | `item_dedup` | COG import duplicate-validator | COG rewrite |
| 4 | Facility dedup advisor | `facility_dedup` | Admin facility import + COG upload | Platform data-model reconciliation (admin) |
| 5 | Division inference | `division_infer` | COG enrichment pipeline | COG rewrite |
| 6 | Data-quality narrator | `quality_narrate` | Post-upload quality panel | COG rewrite |
| 7 | Match-status explainer | `match_status_explain` | Invoice-validation + price-discrepancy row drilldown | Data pipeline |

### Per-feature interface summary

**1. CSV column-mapping assist**
- Input payload: first 10 rows + header row of the CSV, file-type hint (COG / pricing / invoice), facility.
- Output: proposed mapping per column (`sourceColumn` → `targetField`) with confidence + reasoning per column. Unmapped columns included with confidence 0 and reasoning "no plausible target field."
- Model: Haiku 4.5 (mechanical; fast).
- Claude sees no data beyond the 10-row sample.

**2. Vendor dedup advisor**
- Input payload: list of new vendor names from the upload that didn't hit the alias map; existing vendor registry (id + name + normalized name) snapshot.
- Output: for each new name, zero-or-more existing-vendor candidates with `confidence` + `similarityMethod` (levenshtein / phonetic / truncation / typo_pattern / exact_alias) + reasoning.
- Threshold: candidates below confidence 0.6 are dropped from the response. Below 0.6 Claude's signal is noise.
- Model: Haiku 4.5.

**3. Item dedup advisor**
- Input payload: import rows that matched existing records on only `inventoryNumber` *or* only `vendorItemNo`; the existing records (full row); contract-pricing context if the item is on-contract.
- Output: for each ambiguous pair, `confidence` + reasoning + recommended action (`keep_existing`, `replace`, `keep_both`).
- Model: Haiku 4.5.

**4. Facility dedup advisor**
- Input payload: new facility names from import; existing facility registry.
- Output: pair-wise candidates, same shape as vendor dedup.
- Model: Haiku 4.5.

**5. Division inference**
- Input payload: item description + category + vendor name + vendor's divisions (list).
- Output: proposed `divisionId` + confidence + reasoning, or null if none plausible.
- Fallback: rule-based inference (the regex pipeline from the platform data-model reconciliation spec) runs first. Claude is called only when rules return null.
- Model: Haiku 4.5.

**6. Data-quality narrator**
- Input payload: data-quality scoring results (the 8 issue counts from the COG spec §14).
- Output: natural-language summary (<300 words) + 3 prioritized recommendations.
- Model: Opus 4.6 (reasoning-heavy; narrative quality matters).
- Streamed response.

**7. Match-status explainer**
- Input payload: one invoice line or COG row + its `matchStatus` + the relevant contract (if any).
- Output: short paragraph (<150 words) explaining why this row is non-ON_CONTRACT + 1-2 suggested next steps.
- Model: Haiku 4.5 (per-row; must be fast).
- Cached aggressively — same `matchStatus + contractId + variance-bucket` combination returns the same explanation.

---

## 4. Subsystems — priority-ordered

### Subsystem 0 — Credit enum + audit helper (P0)

**Priority:** P0 — blocks every feature.
**Files:**
- Modify: `lib/ai/config.ts` — extend `AICredit.AIAction` enum with the 7 new variants
- Create: `lib/ai/audit.ts` — exports `logAIProposal(kind, entityId, action, metadata)`
- Modify: `prisma/schema.prisma` — no model changes. Verify `AuditLog.entityType` allows `"ai_proposal"` string value.

**Acceptance:**
- `bunx tsc --noEmit` → 0 errors.
- Calling `logAIProposal(...)` inserts an `AuditLog` row with the expected shape.
- Credit costs set to placeholder values (documented as "tune post-ship").

**Plan detail:** On-demand — `00-credits-audit-plan.md`.

---

### Subsystem 1 — Context pack + prompt caching primitives (P0)

**Priority:** P0.
**Files:**
- Create: `lib/ai/context-pack.ts` — `buildContextPack(kind, facilityId, payload)`; returns typed `AIContextPack`
- Create: `lib/ai/prompts/builders.ts` — one builder per kind; assembles system + tools + static context in deterministic order with cache breakpoints
- Create: `lib/ai/__tests__/prompt-cache.test.ts` — asserts byte-identical prefix across two calls with different volatile payloads

**Approach:**
- Each prompt builder returns `{ system, tools, messages, providerOptions }` (Vercel AI SDK shape).
- `providerOptions.anthropic.cacheControl` on the last static message/system text.
- Alias map and facility registry serialized via `JSON.stringify(obj, Object.keys(obj).sort())` helper.

**Acceptance:**
- Test asserting 2nd identical-prefix call reports `cache_read_input_tokens ≥ 0.8 × total input`.
- Test asserting changing volatile payload doesn't change cached prefix bytes.
- `bunx tsc --noEmit` → 0 errors.

**Plan detail:** On-demand — `01-context-pack-plan.md`.

---

### Subsystem 2 — Structured output helpers (P0)

**Priority:** P0.
**Files:**
- Create: `lib/ai/schemas/column-map.ts`
- Create: `lib/ai/schemas/vendor-dedup.ts`
- Create: `lib/ai/schemas/item-dedup.ts`
- Create: `lib/ai/schemas/facility-dedup.ts`
- Create: `lib/ai/schemas/division-infer.ts`
- Create: `lib/ai/schemas/quality-narrate.ts`
- Create: `lib/ai/schemas/match-status-explain.ts`
- Create: `lib/ai/client.ts` — `callClaudeStructured(pack, schema)` wrapper: handles cache config, error mapping, retry-once-on-malformed-output, audit logging

**Acceptance:**
- Each schema exports `Proposal`, `ProposalSchema`, `zodOutputFormat(schema)` bindings.
- `callClaudeStructured` returns typed `{ proposal, usage, auditId }` or throws typed errors.
- Retry-once on malformed output (usually a one-shot parser-disagreement) logged to audit.

**Plan detail:** On-demand — `02-structured-outputs-plan.md`.

---

### Subsystem 3 — AI error handling + rate-limit wrapper (P0)

**Priority:** P0.
**Files:**
- Create: `lib/ai/errors.ts` — `withAIErrorHandling(fn)` HOF that wraps server actions with typed error mapping
- Create: `lib/ai/rate-limit.ts` — `withAIRateLimit(userId, action, fn)` — leverages existing `rateLimit` util
- Create: `lib/ai/fallbacks.ts` — exports deterministic-only fallback functions per feature (e.g. `fuzzyVendorMatchDeterministic` for when Claude is rate-limited or rejects)

**Acceptance:**
- `AuthenticationError`, `RateLimitError`, `APIError`, `Anthropic.BadRequestError` all produce distinct client-facing error shapes.
- Fallback helpers work without Claude (pure functions over the alias map + Levenshtein).
- Rate-limit exhaust → fallback path + banner.

**Plan detail:** On-demand — `03-errors-rate-limit-plan.md`.

---

### Subsystem 4 — Shared review UI (P1)

**Priority:** P1 — blocks every feature that has a review surface.
**Files:**
- Create: `components/shared/ai/ai-review-card.tsx`
- Create: `components/shared/ai/ai-review-panel.tsx`
- Create: `components/shared/ai/ai-review-empty.tsx`
- Create: `components/shared/ai/ai-review-exhausted.tsx`
- Create: `components/shared/ai/ai-review-progress.tsx`

**UX acceptance:**
- Side-by-side layout with responsive behavior (single-column below `md`).
- Same / Different / Skip keyboard shortcuts work.
- Progress bar + `12 / 30` counter.
- `Skip All Remaining` button confirms once, then closes panel.
- Backspace returns to previous card (up to start of session).
- Review panel is mountable anywhere — COG upload dialog, admin facility import, invoice validation drawer.

**Plan detail:** On-demand — `04-review-ui-plan.md`.

---

### Subsystem 5 — AI agent client split + cleanup (P2, tech debt)

**Priority:** P2 — not blocking, but in-scope per user's tech-debt directive.
**Files:**
- Modify: `components/facility/ai-agent-client.tsx` (984 lines) — split into:
  - `ai-agent-client.tsx` (orchestrator, ~150 lines)
  - `ai-agent-conversation.tsx` (message list + streaming rendering)
  - `ai-agent-composer.tsx` (input + send)
  - `ai-agent-suggestions.tsx` (suggested questions chip row)
  - `ai-agent-tool-render.tsx` (per-tool-call display)
  - `ai-agent-empty.tsx` (initial state)
- Audit: `lib/ai/tools.ts`, `lib/ai/prompts.ts` — remove dead tool definitions (if any), consolidate duplicated prompt segments.
- Audit: `lib/ai/schemas.ts` — verify all exports are still imported; delete unused schemas.

**Acceptance:**
- No functional regression on `/dashboard/ai-agent` or `/vendor/ai-agent`.
- Orchestrator file is ≤200 lines; child files are focused.
- Build succeeds; `bunx tsc --noEmit` clean.

**Plan detail:** On-demand — `05-ai-agent-split-plan.md`.

---

### Subsystem 6 — Canonical feature wiring example (P1)

**Priority:** P1 — one feature gets wired end-to-end *here* as the reference implementation. Other features in their owning specs follow the pattern.
**Files:** Implement feature **#6 (Data-quality narrator)** end-to-end.
- Create: `lib/ai/features/quality-narrator.ts` — `narrateDataQuality(facilityId, scoringResult)` server action
- Modify: the data-quality panel (implemented in COG spec) — render streamed Claude output

**Why this feature:**
- Simplest end-to-end example. One input (scoring struct), streaming output (narrative text), no review UI needed.
- Proves the pipeline: context pack → Claude call → streaming response → credit deduction → audit log.
- Other features in COG / data pipeline specs cite this as the reference shape.

**Acceptance:**
- Feeding scoring output produces a <300-word narrative + 3 recommendations.
- Streamed to UI via AI SDK's `streamText`.
- Cache-read ratio ≥80% on repeat call with identical scoring.
- Credits deducted; audit logged.

**Plan detail:** On-demand — `06-quality-narrator-plan.md`.

---

## 5. Execution model

**Sequencing:**

```
Subsystem 0 (credits + audit)
  ↓
Subsystem 1 (context pack)   Subsystem 2 (schemas)   Subsystem 3 (errors)
  ↓                              ↓                       ↓
            Subsystem 4 (review UI)
                   ↓
            Subsystem 6 (reference feature: quality narrator)
                   ↓
            Subsystem 5 (ai-agent client split — can run any time after 0)
```

Subsystems 1-3 are parallelizable after 0. Subsystem 4 depends on all three. Subsystem 6 validates the pipeline end-to-end. Subsystem 5 is independent tech-debt.

**Per-subsystem cadence:** same as prior specs. TDD plan → worktree → subagent-driven execution → verify → merge.

**Global verification (after each subsystem):**

```bash
bunx tsc --noEmit
bun run lint
bun run test
bun run build
bun run db:seed
```

Plus an AI-specific smoke:
```bash
bun run test lib/ai/__tests__/prompt-cache.test.ts  # cache hit rate
```

---

## 6. Acceptance (whole foundation)

- All 6 subsystems merged to main.
- Seven typed schemas compile; each has an example test.
- Review UI renders correctly at every breakpoint; keyboard shortcuts work; fallback + empty states polished.
- Prompt cache hit rate ≥80% on repeat calls with identical prefix.
- `bunx tsc --noEmit` → 0 errors.
- `bun run test` → passing.
- Audit log populates on every AI call with correct metadata.
- Credits deduct correctly; exhaust triggers fallback + banner.
- Rate-limit exhaust triggers fallback + banner.
- `ai-agent-client.tsx` split; orchestrator ≤200 lines.
- Data-quality narrator (subsystem 6) works end-to-end: scoring → context pack → Claude → streamed narrative → UI.

---

## 7. Known risks

1. **Prompt cache drift.** A careless edit to the alias-map serializer or a new timestamp in system text tanks cache hits silently. Cost jumps 10x. Mitigation: `prompt-cache.test.ts` runs in CI; failing cache-hit rate breaks the build.
2. **Claude returns well-formed output that's semantically wrong** ("this is a match" when it isn't). Review UX catches this because users confirm — but users may not scrutinize at scale. Mitigation: no silent auto-apply (v1 is advisory) + audit log gives us the data to measure.
3. **Over-trusting confidence.** Confidence scores from LLMs are notoriously uncalibrated. We *display* them but never *gate* on them in v1. Threshold-based gating is a v2 decision once we have audit-log data.
4. **Credit cost placeholder values.** Set once, may under- or over-charge real usage. Mitigation: post-ship audit-log review at weekly cadence for the first month, then quarterly.
5. **Haiku vs Opus routing mistakes.** Easy to default Opus for everything and blow the budget. Each feature spec explicitly names its model; code review flags changes.
6. **AI SDK version drift.** `@ai-sdk/anthropic` is pinned; major bumps can change streaming event shapes. Mitigation: lockfile + dependabot audit.
7. **Structured-output parse failures.** Zod + Anthropic is reliable, but malformed output happens. Retry-once-then-fail is the policy; malformed outputs go to audit for review.

---

## 8. Out of scope (explicit)

- **Tiered auto-apply / confidence thresholds for silent action.** V1 is advisory. V2 decision pending audit-log data.
- **Claude Managed Agents / per-session containers.** Not this pass.
- **Background / batch AI jobs.** Every call is user-initiated.
- **Memory tool / cross-session context.** Not this pass.
- **Non-English prompts + outputs.** English-only for v1.
- **Custom fine-tunes or fine-tuning infrastructure.** Base Opus 4.6 / Haiku 4.5 only.
- **Narrative AI features beyond the 7.** Renewal briefs, tier advisors, true-margin narratives, multi-contract NL queries are a separate future spec.
- **Non-Anthropic provider swap.** `@ai-sdk/anthropic` is the only provider.

---

## 9. How to iterate

1. Pick a subsystem from the priority-ordered list (start with 0).
2. Ask me to generate its detailed per-subsystem plan via superpowers:writing-plans.
3. Execute per plan; commit each subsystem separately.
4. Verify acceptance; merge to main; proceed to next subsystem.

Per-subsystem plans land in `docs/superpowers/plans/`. This design spec stays as the anchor doc.
