# Charles W1.Y-D — Minimum Annual Purchase: floor semantics + rolling-12 math

**Date:** 2026-04-20
**Reporter:** Charles (iMessage 2026-04-20 11:34 AM)

## Problem

Charles, pointing at the "Minimum Annual Purchase" field on the contract form: *"is this doing any math or is it just a reference?"*

Then: *"If there is a floor on this the math needs to run the rolling 12 so that it can see the rebate that is needed based on the terms to pay the Amortization off."*

Two orthogonal asks:

- **D1 — Is the field active or decorative?** Today the `minAnnualPurchase` input exists on the term form but there's no grep hit for it anywhere in accrual or validation logic (confirmed by grep — spec author's finding). So it is currently decorative. Decide: make it active (floor) or label it as "reference only" in the form help text.
- **D2 — If it's a floor, run the math.** When the contract defines a minAnnualPurchase, surface a derived metric: "Rolling-12 spend: $X · minimum: $Y · gap: $Z · needed-rebate-to-retire-capital: $W." This lives on the Capital Amortization card (tie-in) or on the contract header (usage) depending on contract type.

## Approach

### Decision (product)

Make it an **active floor on tie-in contracts** (where Charles's amortization math applies). On non-tie-in contracts, keep it reference-only with a help tooltip.

On tie-in: if rolling-12 spend < minAnnualPurchase, the contract is underperforming — the capital amortization will not fully retire via rebates at the current pace. Surface this as a Red/Amber status on the Capital Amortization card.

### Step 1 — Validator + server enforcement

- Add `minAnnualPurchase` (number, nullable) to `lib/validators/contract-terms.ts` if not already there. Confirm it's persisted.
- In `lib/contracts/score-benchmarks.ts` (or the health-status reducer), if tie-in and rolling-12 < minAnnualPurchase: status = at-risk.

### Step 2 — New reducer: rolling-12 shortfall vs minimum

`lib/contracts/min-annual-shortfall.ts`:

```ts
export function computeMinAnnualShortfall(
  rolling12Spend: number,
  minAnnualPurchase: number | null,
): { floor: number | null; spend: number; gap: number; met: boolean } {
  if (minAnnualPurchase == null || minAnnualPurchase <= 0) {
    return { floor: null, spend: rolling12Spend, gap: 0, met: true }
  }
  const gap = Math.max(minAnnualPurchase - rolling12Spend, 0)
  return { floor: minAnnualPurchase, spend: rolling12Spend, gap, met: gap === 0 }
}
```

### Step 3 — Capital-retirement-needed reducer (tie-in-specific)

`lib/contracts/capital-retirement-needed.ts`:

Given `capitalAmount`, `sumRebateAppliedToCapital` (from W1.Y-C), `monthsRemaining`, and current tier %:

- remaining capital = capitalAmount − applied
- monthly needed = remaining / monthsRemaining
- monthly spend needed (at current tier %) = monthly needed / (tier rate / 100)
- rolling-12 spend needed = monthly × 12

Returns `{ remainingCapital, monthlySpendNeeded, annualSpendNeeded }`. Used by the Capital Amortization card to show "You need $X/yr in spend at your current tier to retire this capital."

### Step 4 — UI: Capital Amortization card

Add two new rows on `components/contracts/contract-amortization-card.tsx` (coordinates with W1.Y-C's C3 additions):

- **Minimum Annual Purchase:** `{formatCurrency(minAnnual)}` — with a Met/At-Risk badge based on rolling-12.
- **Spend needed to retire capital:** `{formatCurrency(annualSpendNeeded)}` with a tooltip explaining "at your current tier rebate %, this much annual spend over the remaining term will close the amortization."

### Step 5 — Form help text (D1 "is this doing any math")

On the term form (`contract-form.tsx` or wherever minAnnualPurchase is rendered), update the help text:

- For tie-in: *"Floor. If 12-month spend falls below this, the contract will not retire its capital on schedule. Drives the at-risk badge on the Capital Amortization card."*
- For non-tie-in: *"Reference only — not enforced in rebate math today. Contact your TAM if you need this to trigger an alert."*

### Step 6 — Tests

- Unit test for `computeMinAnnualShortfall` — floor null, floor met, floor unmet.
- Unit test for `computeCapitalRetirementNeeded` — basic math.
- Integration test: seed a tie-in contract with minAnnualPurchase above rolling-12, assert the health badge returns at-risk and the card shows the shortfall value.
- Named test: `it("surfaces the rolling-12 shortfall + retirement math (Charles iMessage 2026-04-20)")`.

## Files

- `lib/contracts/min-annual-shortfall.ts` — new reducer
- `lib/contracts/__tests__/min-annual-shortfall.test.ts`
- `lib/contracts/capital-retirement-needed.ts` — new reducer
- `lib/contracts/__tests__/capital-retirement-needed.test.ts`
- `components/contracts/contract-amortization-card.tsx` — render new rows
- `components/contracts/contract-form.tsx` (or term-form file) — help-text clarification
- `lib/contracts/score-benchmarks.ts` (or health-status reducer) — at-risk state
- `lib/actions/__tests__/tiein-min-annual-integration.test.ts`

## Out of scope

- Alerting when rolling-12 drops below floor mid-term (would live in the alerts system; follow-up).
- Retroactive auto-renegotiation flows.
