# Rebate Optimizer Rewrite — Design Spec

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement the subsystems below. Each subsystem gets its own per-subsystem TDD plan generated on demand. Steps use checkbox (`- [ ]`) syntax for tracking.

**Date:** 2026-04-18
**Branch:** continue in `contracts-rewrite-00-schema`
**Status:** Design approved by Vick (2026-04-18) via batch approval
**Brainstormed via:** superpowers:brainstorming
**Related specs:**
- Required dependency: `2026-04-18-contracts-rewrite.md` (rebate engine + tier progress from subsystems 1 + 2)
- Required dependency: `2026-04-18-cog-data-rewrite.md` (enriched COG + contract-save recompute for vendor spend)
- Required dependency: `2026-04-18-platform-data-model-reconciliation.md` (vendor normalization + resolve cascade)
- Required dependency: `2026-04-18-ai-integration-foundation.md` (AI Recommendations panel)
- Required dependency: `2026-04-18-rebate-term-types-extension.md` (handle carve-out / po_rebate variants)

**Goal:** Rewrite `/dashboard/rebate-optimizer` as the **opportunity-detection hub** — surface active rebate contracts sorted by ROI of additional spend, show tier-progress visualizations, provide a what-if rebate calculator, and recommend which contracts to prioritize for tier advancement. All numbers come from the contracts-rewrite engines; this page is the presentation + ranking layer.

**Architecture:** Single page (`app/dashboard/rebate-optimizer/page.tsx`) with ~5 client components. No new schema — everything reads from `Contract`, `ContractTerm`, `ContractTier`, `COGRecord`, `ContractPeriod`. The "opportunity detection engine" is a pure function over those reads + the contracts-rewrite rebate engine.

**Tech Stack (unchanged):** Next.js 16, Prisma 7, TanStack Query, recharts, Zod, shadcn/ui. Canonical doc is 1408 lines; tydei's version will be lighter (~600-800 lines of client code + ~200 of server actions) because most math lives in shared libs from contracts-rewrite.

---

## 1. Scope

### In scope

- **Opportunity detection engine** (§3 of canonical) — pure function that walks active contracts with rebate tiers, computes current vs next tier, spend gap, additional-rebate projection, ROI, and urgency classification
- **Summary KPI cards** — Earned YTD / Potential Additional / On-Track Contracts / At-Risk Contracts
- **Rebate earnings chart** — monthly earned rebate over last 12 months; uses existing contracts-rewrite accrual data
- **Contract tier-progress list** — per-contract card showing current tier, tier progress bar, spend-to-next, additional rebate
- **Vendor filter + category filter** — scope the opportunity list
- **AI Recommendations panel** — advisory suggestions ("focus on X for highest ROI") via AI foundation match-status explainer shape, scoped to the optimizer context
- **Rebate calculator dialog** — what-if sim: user enters proposed additional spend, sees new projected tier + rebate
- **Quick Win alert** — highlights contracts where `spendNeeded < some threshold` AND `ROI > threshold`
- **Tech debt:** audit `lib/actions/rebate-optimizer.ts` (204 lines existing); split if any function over ~80 lines

### Out of scope

- **Auto-execution of recommendations** (e.g., "buy $20K from Stryker to hit tier 3"). Advisory only.
- **Multi-contract ROI comparison beyond a ranked list**. No "bundle these 3 contracts for best combined tier" analysis.
- **Marginal-method tier math** special casing. The contracts-rewrite rebate engine already handles marginal; this page doesn't re-derive.
- **Carve-out and po_rebate visualization** — the optimizer shows `spend_rebate` opportunities. Contracts whose *only* rebate terms are carve-out or po_rebate are filtered out with a "Not optimizable — different rebate structure" badge in v2. v1 simply omits them.
- **Vendor portal equivalent** — separate spec (vendor has its own performance/market-share pages).
- **Rebate-claim workflow** — marking a rebate as collected lives on contract detail, not here.

### Non-goals (preserved)

- No stack swaps.
- No new schema.

---

## 2. Translation notes — canonical prototype → tydei

| Prototype pattern | Tydei equivalent |
|---|---|
| `useState` for contracts + cogData + loading | TanStack Query hooks (`useActiveContracts`, `useCogAggregate`) |
| `buildRebateContractsFromData(contracts, cogData)` | Server action `getRebateOptimizerData(facilityId)` returns pre-shaped `RebateContractView[]` |
| Normalized vendor name + 3-way match | Uses platform-data-model §4.3 `findVendorByName` cascade (typed vendorId FK in tydei makes this trivial) |
| In-memory spend aggregation on COG records | Server-side SQL aggregation (`groupBy vendorId`) |
| `calculateContractData(contract)` per-contract helper | Uses `computeRebateFromPrismaTiers` + `calculateTierProgress` from contracts-rewrite |
| AI Recommendations Panel (mock recommendations in prototype) | Real Claude call via AI foundation; advisory-only; no state changes |
| Eligibility filter: "has rebate tiers" | Same rule; excludes contracts where `terms` has only `carve_out` or `po_rebate` types |
| Tier normalization priority (several legacy shapes) | No need; tydei's `ContractTier` has one canonical shape |
| Rebate Calculator Dialog with in-page state | Shadcn Dialog + `react-hook-form` |

---

## 3. Data model changes

**None.** Everything exists:
- `Contract`, `ContractTerm`, `ContractTier` — all populated
- `COGRecord` with enrichment columns + `matchStatus` (from cog-data spec)
- `ContractPeriod` + `RebateAccrual` for historical earning data

---

## 4. Subsystems — priority-ordered

### Subsystem 0 — Data layer audit + opportunity engine (P0)

**Priority:** P0 — blocks every UI subsystem.

**Files:**
- Audit: `lib/actions/rebate-optimizer.ts` (204 lines) — catalog functions; flag drift vs canonical
- Create: `lib/rebate-optimizer/engine.ts` — pure functions:
  - `buildRebateOpportunities(contracts, vendorSpendMap)` — returns `RebateOpportunity[]` per canonical §6
  - `classifyUrgency(spendNeeded, daysRemaining)` — HIGH / MEDIUM / LOW
  - `computeROI(additionalRebate, spendNeeded)` — returns percentage
- Create: `lib/rebate-optimizer/__tests__/engine.test.ts`
- Modify: `lib/actions/rebate-optimizer.ts` — add `getRebateOptimizerData(facilityId, filters?)` returning one server-side-assembled payload

**Return shape:**

```ts
interface RebateOptimizerData {
  contracts: RebateContractView[]
  opportunities: RebateOpportunity[]
  monthlyEarnings: { month: string; earned: number }[]  // last 12
  summary: {
    earnedYTD: number
    potentialAdditional: number
    onTrackContracts: number
    atRiskContracts: number
  }
}
```

**Urgency classification** (canonical §6.5):
- `HIGH`: `spendNeeded < $100K` OR `daysRemaining < 60`
- `MEDIUM`: `spendNeeded < $250K`
- `LOW`: otherwise

**Acceptance:**
- Engine returns typed opportunities sorted by ROI descending.
- Tests cover: tier-at-max (no next tier → excluded), zero-spend contract (excluded), contract with non-spend_rebate-only terms (excluded with reason).
- `bunx tsc --noEmit` → 0 errors.

**Plan detail:** On-demand — `00-engine-plan.md`.

---

### Subsystem 1 — Summary KPI cards (P1)

**Priority:** P1.

**Files:**
- Create: `components/facility/rebate-optimizer/optimizer-summary.tsx` — 4-card grid (uses uniform `MetricCard` slot from dashboard spec pattern)

**4 cards:**

| Card | Value | Source |
|---|---|---|
| Earned YTD | `summary.earnedYTD` | sum of `rebateEarned` across eligible contracts |
| Potential Additional | `summary.potentialAdditional` | sum of `additionalRebate` across top opportunities |
| On-Track Contracts | `summary.onTrackContracts` | count where `currentTierProgress >= 70%` |
| At-Risk Contracts | `summary.atRiskContracts` | count where `currentTierProgress < 40%` AND `daysRemaining < 90` |

**Acceptance:**
- Equal card heights at all breakpoints.
- Values update via TanStack Query invalidation on contract/COG mutations.

**Plan detail:** On-demand — `01-summary-cards-plan.md`.

---

### Subsystem 2 — Rebate earnings chart (P1)

**Priority:** P1.

**Files:**
- Create: `components/facility/rebate-optimizer/earnings-chart.tsx` — recharts line/area chart over last 12 months
- Data source: `RebateAccrual` rows (contracts-rewrite subsystem 3) aggregated by month

**Acceptance:**
- Chart renders with current-month accrual (partial) visibly distinct
- Empty state when no accruals exist
- Hover tooltips show $ + month

**Plan detail:** On-demand — `02-earnings-chart-plan.md`.

---

### Subsystem 3 — Contract tier-progress list (P1)

**Priority:** P1.

**Files:**
- Create: `components/facility/rebate-optimizer/opportunity-list.tsx` — scrollable list of `OpportunityCard`
- Create: `components/facility/rebate-optimizer/opportunity-card.tsx` — per-contract card with:
  - Contract name + vendor + days remaining
  - Current tier + next tier
  - Progress bar (current spend / next threshold)
  - Spend to next + additional rebate projection
  - ROI % (color-coded: ≥10% green, ≥5% amber, else muted)
  - Urgency badge (HIGH / MEDIUM / LOW)

**Acceptance:**
- List sorted by ROI descending.
- Clicking a card opens the rebate calculator dialog (subsystem 6) pre-filled with that contract.
- Link to `/dashboard/contracts/[id]` from card header.

**Plan detail:** On-demand — `03-opportunity-list-plan.md`.

---

### Subsystem 4 — Vendor + category filter (P2)

**Priority:** P2.

**Files:**
- Modify: `components/facility/rebate-optimizer/optimizer-client.tsx` — filter bar
- Wire: filter values into `getRebateOptimizerData(facilityId, filters)`

**Filter dimensions:**
- Vendor — single-select, populated from contracts' vendor list
- Product category — single-select, populated from active contracts' categories
- Urgency — multi-select (HIGH / MEDIUM / LOW)

**Acceptance:**
- Filter change triggers TanStack re-fetch with new params.
- Summary cards respect the filter (unlike the list page from contracts-list-closure where summary ignores filters — opposite behavior here because "what's my earned YTD for Stryker specifically" is a real question).

**Plan detail:** On-demand — `04-filter-plan.md`.

---

### Subsystem 5 — Quick Win alert + AI recommendations (P1)

**Priority:** P1.

**Files:**
- Create: `components/facility/rebate-optimizer/quick-win-alert.tsx` — dismissible banner when at least one opportunity matches both:
  - `spendNeeded < $50K`
  - `ROI > 15%`
  - Label: "Quick Win: $X more to Stryker earns $Y additional rebate"
- Create: `components/facility/rebate-optimizer/ai-recommendations-panel.tsx` — Claude call via AI foundation
  - Input context: top 5 opportunities with reasoning
  - Output: natural-language ranked recommendations + rationale
  - Model: Opus 4.6 (reasoning-heavy)
  - Advisory-only; user confirms any action (which means "click the opportunity card" — no state change)

**Acceptance:**
- Quick Win banner appears only when a match exists.
- AI recommendations stream in; audit-logged; credits deducted.
- If no Claude credits or API error → static fallback ("Top opportunities by ROI: ..." list).

**Plan detail:** On-demand — `05-quick-win-ai-plan.md`.

---

### Subsystem 6 — Rebate calculator dialog (P1)

**Priority:** P1.

**Files:**
- Create: `components/facility/rebate-optimizer/rebate-calculator-dialog.tsx` — shadcn Dialog
- Inputs (react-hook-form):
  - Contract (pre-selected or picker)
  - Additional spend amount ($)
- Outputs (live-computed):
  - Current spend + tier
  - New spend + new tier
  - Rebate delta
  - "If you spend $X more, you reach Tier N (+$Y rebate)"

**Engine:** calls `computeRebateFromPrismaTiers` from contracts-rewrite; no new math.

**Acceptance:**
- Live update as user types amount (debounced 300ms).
- Tier-change highlighted visually.
- Handles marginal method correctly (engine does).

**Plan detail:** On-demand — `06-calculator-plan.md`.

---

### Subsystem 7 — UI polish (P2)

**Priority:** P2.

**Files:**
- Modify: `components/facility/rebate-optimizer/optimizer-client.tsx` + children
- Polish items:
  - Empty state (no active rebate contracts)
  - Empty opportunities (all contracts at max tier or very far from next)
  - a11y on urgency badges (color + text label)
  - Responsive breakpoints

**Acceptance:**
- Manual smoke at `sm`, `md`, `lg`, `xl`.
- Lighthouse a11y pass.

**Plan detail:** On-demand — `07-ui-polish-plan.md`.

---

## 5. Execution model

```
Subsystem 0 (engine + audit)
  ↓
Subsystem 1 (summary)   Subsystem 2 (earnings chart)   Subsystem 3 (opportunity list)
  ↓                       ↓                              ↓
         Subsystem 4 (filters)
                ↓
         Subsystem 5 (quick-win + AI)
                ↓
         Subsystem 6 (calculator dialog)
                ↓
         Subsystem 7 (UI polish)
```

**Global verification** — same as prior specs.

---

## 6. Acceptance

- All 8 subsystems merged.
- Opportunities sorted by ROI; summary cards reflect truth.
- AI recommendations panel streaming; advisory only; credits + audit working.
- Calculator dialog live-computes correct tier + rebate via contracts-rewrite engine.
- `bunx tsc --noEmit` → 0 errors; `bun run test` → passing.

---

## 7. Known risks

1. **Contracts with non-spend_rebate rebate term types.** A contract whose only rebate term is `po_rebate` or `carve_out` has different semantics — the optimizer drops them. Mitigation: engine explicit filter; UI shows dropped-count footer ("3 contracts use alternative rebate structures not supported here — [View all contracts]").
2. **Stale AI recommendations.** Claude output cached per `{contractId, spend}` tuple. Cache bust on contract mutation.
3. **"At-risk" classification ambiguity.** Our cutoff (progress < 40% AND days remaining < 90) may label too many or too few. Mitigation: configurable thresholds; start with these values + tune post-ship.
4. **Calculator marginal-method correctness.** Test both method values in subsystem 6's suite.
5. **Aggregate cost at scale.** Hundreds of active contracts × tier computation × 12 months × AI call = noticeable latency. Mitigation: materialized views on `ContractPeriod` summing per month; cap AI input to top 5 opportunities.

---

## 8. Out of scope (explicit)

- Auto-execute recommendations
- Multi-contract bundle optimization
- Vendor portal equivalent
- Rebate-claim workflow
- Contracts with carve-out-only or po_rebate-only structures (dropped with reason in v1)

---

## 9. How to iterate

1. Start with subsystem 0.
2. Generate per-subsystem plan via superpowers:writing-plans.
3. Execute; commit each separately.
4. Verify; merge; proceed.
