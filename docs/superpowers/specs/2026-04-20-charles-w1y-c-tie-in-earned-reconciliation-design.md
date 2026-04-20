# Charles W1.Y-C — Tie-in: earned rebates + capital reconciliation

**Date:** 2026-04-20
**Reporter:** Charles (iMessage 2026-04-20 11:37-11:44 AM)

## Problem

Two related issues on tie-in contracts:

### C1 — Rebates Earned (YTD) = $0

Screenshot shows a tie-in contract with:
- Contract Value $1,290,739
- Current Spend (Last 12 Months) $312,056
- **Rebates Earned (YTD) $0** · "$0 collected (lifetime)"
- Transactions tab: *"No rebate transactions yet."*

Expected: rebates should accrue on tie-in contracts' spend just like usage contracts.

### C2 — Three-way capital-payoff disagreement

A second tie-in (screenshot 11:42 AM) shows:
- Rebates Earned (YTD) **$19,280** · "$195,124 collected (lifetime)"
- "$185,124 applied to capital · $0 cash rebate"
- Capital Amortization card Paid to Date **$293,465** · Remaining $206,535

Charles: *"it says they earned 293K paid down using a rebate but it says up top that ONLY 185K have been used to pay down the capital. All of the rebate earned on these deals should go toward paying down the capital."*

Three numbers that should agree but don't:
1. `$293,465` — Capital Amortization "Paid to Date"
2. `$185,124` — "applied to capital" (header card sublabel)
3. `$19,280` YTD / `$195,124` lifetime — Rebates Earned/Collected

Charles's intent: on tie-in deals, ALL earned rebate retires capital. The three surfaces must share one reducer.

### C3 — UX: show rebate + remaining balance on Capital Amortization card

Charles (11:44 AM): *"Maybe here it should show the rebate they earned and if there is a balance on what is due as well."* Add explicit "Rebates Applied (lifetime)" and "Balance Due" fields on the Capital Amortization card so the user can eyeball the math without navigating.

## Approach

### Step 0 — Diagnostic

Script `scripts/diagnose-tiein-rebate-capital.ts`:

- For both screenshot contracts (match on contractType=tie_in):
  - Print raw `Rebate` rows: `id, payPeriodStart, payPeriodEnd, rebateEarned, rebateCollected, collectionDate, notes`.
  - Print `Contract.capitalAmount`, `capitalMonths`, `capitalRate` and whatever else lives on the contract for tie-in.
  - Print `contractTypeEarnsRebates(contract.contractType)` for each.
  - Print every "applied-to-capital" amount the UI references and its source reducer.
- Dump to `docs/superpowers/diagnostics/2026-04-20-w1y-c-tiein.md`.

### Step 1 — Fix earned-rebate display for tie-in (C1)

If `contractTypeEarnsRebates("tie_in") === false`, that's the bug — the engine skips accrual for tie-in. Fix: tie-in contracts DO earn rebates (the whole premise is rebates retire capital). Update `lib/contract-definitions.ts` and re-run `recomputeAccrualForContract` on existing tie-in contracts.

If the rule is correct but the UI doesn't surface the earned number, fix the UI — the `Rebates Earned (YTD)` card should always render from the canonical `sumEarnedRebatesYTD` helper regardless of contract type.

### Step 2 — Canonical capital-applied reducer (C2)

Introduce `sumRebateAppliedToCapital(rebates, contract)` in `lib/contracts/rebate-capital-filter.ts`:

- For tie-in contracts: returns `sumCollectedRebates(rebates)` (ALL collected rebate retires capital — Charles's rule).
- For non-tie-in contracts: returns 0 (no capital to retire).

Register it as a canonical helper in CLAUDE.md's invariants table. Every surface that renders a capital-applied / capital-paid-down number routes through this helper:

- Contract header card "applied to capital" sublabel
- Capital Amortization card "Paid to Date"
- Any tie-in dashboard or report

`Capital Amortization.Paid to Date` stops computing from the amortization schedule's elapsed months × monthly payment (if that's what it does today) and instead uses `sumRebateAppliedToCapital`. Remaining = capitalAmount − paidToDate, clamped ≥ 0.

### Step 3 — UX: show rebate + balance on Capital Amortization card (C3)

In `components/contracts/contract-amortization-card.tsx`, add two labeled fields near the top:

- **Rebates Applied (lifetime)**: `sumRebateAppliedToCapital` in currency.
- **Balance Due**: `Math.max(capitalAmount − rebatesApplied − cashPrincipal, 0)` with tooltip explaining the math.

### Step 4 — Tests

`lib/contracts/__tests__/rebate-capital-filter.test.ts`:

- Unit tests on the new helper: tie-in yields sum of collected; non-tie-in yields 0; mixed collected/earned only sums collected.

`lib/actions/__tests__/tiein-capital-parity.test.ts`:

- Seed a tie-in contract with:
  - `capitalAmount: 500_000`, `capitalMonths: 60`, `capitalRate: 0.05`
  - 3 Rebate rows with collectionDate set (total collected = $195,124) + 1 earned-uncollected row ($19,280 YTD).
- Call every surface's reducer. Assert all three show the same `$195,124` applied-to-capital number.
- Named `it("tie-in capital-applied reconciles across surfaces (Charles iMessage 2026-04-20)")`.

### Step 5 — CLAUDE.md invariants table

Add a row:

```md
| Rebate applied to capital (tie-in) | `sumRebateAppliedToCapital` | `lib/contracts/rebate-capital-filter.ts` | contract-header applied-to-capital sublabel, Capital Amortization card Paid-to-Date + Balance-Due, tie-in dashboards |
```

## Files

- `scripts/diagnose-tiein-rebate-capital.ts`
- `docs/superpowers/diagnostics/2026-04-20-w1y-c-tiein.md`
- `lib/contract-definitions.ts` — fix `contractTypeEarnsRebates` if needed
- `lib/contracts/rebate-capital-filter.ts` — new canonical helper
- `components/contracts/contract-amortization-card.tsx` — surface rebate-applied + balance-due
- `components/contracts/contract-detail-overview.tsx` (or wherever the header card's sublabel lives) — use the helper
- `lib/contracts/__tests__/rebate-capital-filter.test.ts`
- `lib/actions/__tests__/tiein-capital-parity.test.ts`
- `CLAUDE.md` — invariants table row

## Out of scope

- Mixed cash-rebate + capital-applied deals (user would select which earned rebate goes to capital vs cash payout). Today Charles's rule is 100% to capital.
- Changing the amortization schedule itself to account for early payoffs (spec'd as a separate concern — the schedule is a forecast, not a ledger).
