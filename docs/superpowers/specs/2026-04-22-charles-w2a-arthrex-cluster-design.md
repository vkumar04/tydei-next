# Charles W2.A — Arthrex contract cluster: diagnostic-first

**Date:** 2026-04-22
**Author:** Vick (via superpowers brainstorming)
**Reporter:** Charles (iMessage screenshots, 2026-04-22 12:42 PM)

## Problem

Charles opened what appears to be the demo facility's Arthrex, Inc. contract
(value $1,808,002, expires Nov 29 2027, type Usage, categories
Disposables-Capital / Extremities & Trauma / Ortho-Extremity / Ortho-Sports
Med) and reported four numeric/classification bugs on the contract detail
page, plus a fifth non-determinism bug tracked separately.

**In scope (this spec):**

1. **On vs Off Contract Spend** card: `$0 On Contract` and `$3,389,667 Not
   Priced`. Charles: *"Nothing ON contract."*
2. **Current Spend (Last 12 Months)** flips between `$0` and `$1,559,528` on
   reload. Charles: *"Showing no spend in last 12."*
3. **Rebates Earned (YTD)** header card says `$0` while the Transactions tab
   shows **Total Rebates (lifetime) = $639,390** with two periods
   ($319,525 and $319,865) both marked **Overdue**. Charles: *"The 12 month
   rebate issue I mention above is still here."* Header and Transactions tab
   are not agreeing — classic canonical-reducer drift.
4. **Rebate amounts suspiciously identical** — the two period earnings are
   within $340 of each other. Charles: *"These rebates earned can't be right
   because this is real data and this would indicate that they spend exactly
   to the dollar the same amount of money to get that rebate."* Hypothesis:
   the tier engine is synthesising "spend = target threshold" instead of
   consuming actual COG spend.

**Out of scope (separate spec):**

5. Terms-and-conditions non-determinism across multiple contracts →
   `2026-04-22-charles-w2b-terms-nondeterminism-design.md`.

## Working hypothesis

(1) is the root cause. If the COG matcher misclassifies Arthrex purchase
orders, then `sumOnContractSpend(contract.id)` returns $0, the tier-progress
calc reads `$0 / $1,808,002`, and the header's YTD rebate card reads
`$0`. The Transactions tab, however, reads `Rebate` rows that were written by
a *prior* run — likely before the matcher regressed — so it correctly shows
$639,390 of lifetime earnings. (2) is whatever caches or races between the
server action runs. (4) is a symptom: if the Rebate rows were written against
fabricated "spend == target" inputs, the earned amounts will mirror the tier
thresholds rather than real COG spend.

We do not know for sure without querying the demo DB. Hence the
diagnostic-first design.

## Approach — two phases

### Phase 1 — Diagnostic (one commit, gated)

New script: `scripts/diagnose-arthrex-cluster.ts`.

**Inputs:** optional `--contractId=<id>`; if omitted, find by predicate
(vendor name like `%Arthrex%` + facility = demo + value ≈ $1,808,002).

**What it dumps (in order):**

1. Contract row (all fields, including `status`, `engineVersion`,
   `lastMatchRunAt` if present, `createdAt`/`updatedAt`).
2. All `ContractTier` rows: baseline, target thresholds, `rebateValue` raw
   (fraction) and scaled (percent), `rebateKind`.
3. All `Rebate` rows: `payPeriodStart`, `payPeriodEnd`, `amountEarned`,
   `collectionDate`, `collectedAmount`, `engineVersion`, `createdAt`.
4. All `ContractPeriod` rollups if any.
5. COG rows in `scopeOR = [{ contractId }, { contractId: null, vendorId }]`,
   aggregated by `matchStatus` (count + `SUM(extendedPrice)`) + 10 sample
   rows per bucket (PO number, vendor item, description, extendedPrice,
   matchStatus, matchConfidence).
6. COG rows trailing-12-months slice (same scope) by `matchStatus`.
7. **The exact return values** of the four surface-feeding server actions:
   - header card metrics (file TBD — grep `Rebates Earned (YTD)` card)
   - On/Off Contract Spend card action (`lib/actions/contracts/off-contract-spend.ts`)
   - Transactions tab action (file TBD)
   - Contract list row metrics for this contract (`getContracts`)
   Print raw JSON (or key→value lines) for each, labelled.
8. Reconciliation delta: header's "Rebates Collected (lifetime)" vs
   `sumCollectedRebates(arthrexRebates)`; header's "Rebates Earned (YTD)"
   vs `sumEarnedRebatesYTD(arthrexRebates)`; Transactions tab's
   "Total Rebates (lifetime)" vs `sumEarnedRebatesLifetime(arthrexRebates)`.

**Output:** `docs/superpowers/diagnostics/2026-04-22-w2a-arthrex-cluster.md`.

**Stop condition:** once the diagnostic is committed, the plan pauses. Vick
reads the output and decides Phase 2 decomposition based on what's true.

### Phase 2 — Decomposition (written after Phase 1 runs)

Candidate sub-specs I expect the diagnostic to justify. Each gets its own
plan + subagent + cherry-pick so the easy ones ship independently.

- **2a. COG match misclassification.** If Arthrex rows pile into
  `out_of_scope` / `unknown_vendor` when they should be `on_contract`, fix
  the matcher and add a regression test pinning expected bucket counts. Owns
  bug (1). Likely also unblocks (3) and (4) if rebates re-accrue.
- **2b. Header ↔ Transactions-tab parity.** If the header card reads a
  different path than the Transactions tab, re-route it through
  `sumEarnedRebatesYTD` / `sumCollectedRebates` (canonical helpers from the
  invariants table). Widen
  `contracts-list-vs-detail-parity.test.ts` to cover the contract-detail
  header card. Owns bug (3).
- **2c. Current-spend flicker.** If (2) is a client-cache or server-action
  race, pin the trailing-12mo cascade as the one source for the card.
  Regression test that loads the action twice in the same ms and asserts
  equality. Owns bug (2).
- **2d. Tier-engine fabrication / stale Rebate rows.** If the $319K/$319K
  rebates were written against a synthetic spend input (or if
  `computeRebateFromPrismaTiers` is accidentally consuming `tier.target`
  instead of actual spend), patch the engine and back-fill the affected
  Rebate rows (or flag them). Owns bug (4).

Each sub-spec will be written only after Phase 1 data confirms it's real.
Pure-data issues (e.g., stale Rebate rows with no code bug) get a one-off
migration script instead of a full spec.

## Non-goals

- Fixing bug (5) — different surface, different code path, separate spec.
- Any refactor outside the four surfaces named above.
- Touching the rebate engine's math itself unless Phase 1 data proves a
  specific function is wrong.
- Decomposing `getContracts` further (the list-row path is already behind
  the canonical helpers per W1.X-D).

## Risks

- **Demo DB data has drifted.** If the Rebate rows were written by an
  older engine version and no longer reflect current tier definitions,
  "fix the code" isn't enough — we'll need a back-fill. Phase 1 will flag
  this via `engineVersion` comparison.
- **Matcher is correct but Arthrex POs genuinely missing contract linkage
  in the feed.** Then bug (1) is data-side, and the fix is on the COG
  enrichment/import path, not the server action.
- **Caching layer (Next.js `unstable_cache`, React Query) masking the
  server's honest answer.** Phase 1 dumps server-side values; the UI
  inconsistency in bug (2) may not reproduce at the script level.

## Success criteria

**Phase 1** succeeds when the diagnostic file is committed and contains all
8 sections with populated (non-empty) data.

**Phase 2** succeeds when, for each confirmed bug, ALL of the following are
true:

1. **Failing regression test first.** A test is written and landed on main
   (or at minimum in the worktree commit) that reproduces the bug against
   a seeded fixture or live demo-DB read. The test must fail on the
   pre-fix commit and pass on the post-fix commit.
2. **Canonical helper used.** The fix re-uses the appropriate helper from
   the invariants table in CLAUDE.md — never hand-rolls a parallel
   reducer. If no helper fits, a new one is added to `lib/contracts/`
   and every existing surface is migrated to it.
3. **Cross-surface parity holds.** Numbers match across contract list row,
   contract-detail header card, On/Off Contract Spend card, Transactions
   tab, and reports — verified by an extension of
   `lib/actions/__tests__/contracts-list-vs-detail-parity.test.ts`.
4. **Full verify checklist green** (per CLAUDE.md release hygiene):
   `bunx tsc --noEmit` → 0 errors; `bunx vitest run --exclude '**/.claude/**'
   --exclude '**/.worktrees/**'` → all green; `rm -rf .next && bun run dev`
   + manual smoke of the Arthrex contract's detail page.
5. **Charles-ready smoke.** Loading the Arthrex contract-detail page five
   times in a row yields identical numbers on all surfaces, and the
   On/Off Contract Spend card reflects a non-zero on-contract amount
   consistent with the tier-progress bar.
