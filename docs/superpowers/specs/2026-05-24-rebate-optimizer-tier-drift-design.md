# Rebate Optimizer Tier Drift — root-cause spec

**Date:** 2026-05-24
**Bug cluster:** B (bugs #4, #5, #6, #8, #10, #11; partially #7)
**Status:** root cause identified; plan pending

## Reproduction
Reference contract from screenshots: **Smith & Nephew Rebate Agreement and Products & Pricing Agreement — Surgical Center at Columbia**. Term is `market_share` / Retroactive (best tier rate × all dollars). Tier ladder is intended as: T1 ≥ 10% MS → 10%, T2 ≥ 50% MS → 15%, T3 ≥ 100% MS → 20%. Facility's `currentMarketShare` ≈ 92%, so the correct answer is **Tier 2 → 15%**.

What user sees:

| Surface | Display | Why |
|---|---|---|
| Contract Detail → Rebates & Tiers | "Current: Tier 3 · 20.0%" | `calculateTierProgress` qualifies by spend dollars; spend(millions) ≫ spendMin(100) → top tier |
| Optimizer → Contract Tier Progress | "CURRENT REBATE: 10%" | Reads stale `contract.periods[0]?.tierAchieved` or falls back to `tiers[0]` |
| Rebate Calculator dialog | Current Tier blank, "Next Tier $10 (1%)" | Same OLD-optimizer source, same wrong tier |
| Smart Recommendations (#7) | "No actionable recommendations" | `mapTermKind` in NEW engine returns null for `market_share` → contract dropped |

## Storage convention (already correct — no migration needed)

`pending-contracts.ts:332-341` documents the **column-reuse pattern**:
- For `market_share` / `compliance_rebate` term types, `marketShareMin` is **mirrored into `spendMin`** at write time.
- For `volume_rebate` / `rebate_per_use` / `capitated_pricing_rebate` / `po_rebate` / `payment_rebate`, `volumeMin` is mirrored into `spendMin`.
- The engine reads `spendMin` as the threshold regardless of term type.
- The dedicated columns (`marketShareMin/Max`, `volumeMin/Max`) are display fallbacks for UI labeling.

The seed (`prisma/seeds/contracts.ts`) and every write path (`pending-contracts.ts`, `imports/contract-import.ts`, `contract-terms.ts`) follow this convention. So the storage is fine.

The "1,499,999.0% market share" label in screenshots is a sentinel `spendMax` value being formatted with a `%` suffix because the term type is `market_share`. Cosmetic, not load-bearing on the math.

## Root cause

> **The engine has no notion of "which contract-level metric belongs to this term type." It always receives a single `currentSpend: number` from its caller and compares against `spendMin`.** Writers correctly stuff the right value in `spendMin` (column-reuse). But readers always pass dollar-spend as `currentSpend`, even for market-share terms, so the threshold (a percent like 100) is trivially crossed by spend (millions).

The contract's WRITER side has this right. See `lib/contracts/recompute/threshold.ts`:
```ts
export type ThresholdMetric = "complianceRate" | "currentMarketShare"
```
It selects the metric per term type and feeds it to `determineTier`. The READERS skipped this routing.

## Affected read paths

1. **`lib/contracts/tier-progress.ts:calculateTierProgress(currentSpend, tiers, method)`** — has no `termType` arg. Callers pass dollar-spend unconditionally.
2. **`lib/actions/rebate-optimizer.ts:40 getRebateOpportunities`** (OLD) — uses `period.tierAchieved` as source of truth and falls back to `tiers[0]`; ignores `currentMarketShare`.
3. **`lib/actions/rebate-optimizer-engine.ts:127 getRebateOpportunities`** (NEW) — `mapTermKind` drops `market_share` entirely.
4. **`components/contracts/contract-terms-display.tsx`** — passes `currentSpend` into the in-component tier qualifier (lines 549-564), and falls back to `spendMin/Max` for display when `marketShareMin/Max` is null (line 274-289). Display fallback combined with sentinel spendMax produces the "1,499,999.0%" ugliness.

## Fix (decided with user)

**Scope decisions confirmed:**
- Keep new engine (`rebate-optimizer-engine.ts`) spend-only; **fix OLD action only** per user choice.
- **No data migration** — storage convention already correct.
- Don't refactor display fallback yet (separate cosmetic bug).

**Changes:**

1. **NEW canonical helper** `lib/contracts/tier-progress-for-term.ts` exporting:
   ```ts
   export function pickThresholdMetric(
     termType: string,
     metrics: { currentSpend: number; currentMarketShare: number | null; complianceRate: number | null; currentVolume: number | null }
   ): number
   ```
   Returns the right metric per term type:
   - `market_share` → `currentMarketShare ?? 0`
   - `compliance_rebate` → `complianceRate ?? 0`
   - `volume_rebate`, `rebate_per_use`, `capitated_pricing_rebate`, `po_rebate`, `payment_rebate` → `currentVolume ?? 0`
   - default (spend-based) → `currentSpend`

2. **`calculateTierProgress` gains an optional `termType` parameter** (default `"spend_rebate"`). When called with a non-spend term type, it expects the appropriate metric in the first arg; the function itself stays metric-agnostic — its docstring just gets clear that callers feed the right metric. Backwards-compatible.

3. **`lib/actions/rebate-optimizer.ts:40 getRebateOpportunities`** rewritten to:
   - Drop the stale `period.tierAchieved` source.
   - For each term, compute the metric via `pickThresholdMetric(term.termType, ...)` using `contract.currentMarketShare`, `complianceRate`, etc. from the Contract row.
   - Compute current tier by sorting tiers on `spendMin` and picking the highest-qualifying.
   - Compute next tier the same way.
   - Keep the `toDisplayRebateValue` scaling at the boundary (already correct).

4. **`components/contracts/contract-terms-display.tsx`** — call the new helper for "Current Tier" rather than passing raw spend.

5. **Optional follow-up (not in this PR):** teach `mapTermKind` in the new engine to absorb `market_share`/`compliance_rebate`/`volume_rebate` so the new engine is no longer spend-only. Tracked as separate task.

## Test plan (TDD-style)

Failing tests authored first:
1. `lib/contracts/__tests__/tier-progress-for-term.test.ts` — exhaustive coverage of `pickThresholdMetric` per term type, plus fall-throughs to defaults.
2. `lib/contracts/__tests__/tier-progress-market-share.test.ts` — a contract with market-share tier ladder + `currentMarketShare=92` returns Tier 2; 105% returns Tier 3; 5% returns no tier.
3. `lib/actions/__tests__/rebate-optimizer-market-share.test.ts` — fixture matching the Smith & Nephew shape; assert `currentTier === 2`, `currentRebatePercent === 15`, `nextTier === 3`, `nextRebatePercent === 20`.
4. `lib/actions/__tests__/contracts-list-vs-detail-parity.test.ts` — extend the existing parity guard to also check tier-progress agreement across contract-detail/optimizer for market-share contracts.

## Out of scope (separate bugs)

- Cosmetic "1,499,999.0% market share" sentinel display — change the fallback path to render "X%+" when `spendMax` is unrealistic (e.g. > 1000). Filed separately.
- Bug #7 root cause for Smart Recommendations (new engine drops market_share) — left in place per user decision; revisit when migrating UI to new engine.
- Bug #15 (tie-in contracts missing market-share / compliance) — likely the same root cause as this, but tie-in is a different code path; separate task.
