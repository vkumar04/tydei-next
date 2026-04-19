# Tie-In Parity Implementation — Waves A, B, C

Charles approved the brief. Ship all three waves. Research at
`docs/superpowers/specs/2026-04-19-tie-in-research.md`.

## Wave A — UI wiring (no schema changes)
1. Amortization schedule card on contract detail — render rows from
   `buildTieInAmortizationSchedule` (period, opening, interest, principal,
   amortization due, closing).
2. Capital summary strip — 3 tiles: Remaining Balance, Paid To Date,
   Projected Payoff Date (linear projection from run-rate).
3. Rebate split widget — on any tie-in contract's Rebates Earned card,
   show `Applied to capital: $X / Cash rebate: $Y` using the engine's
   `trueUpAdjustment` semantics.

## Wave B — form fields (additive schema)
1. `ContractTerm.downPayment Decimal?` + form input.
2. `ContractTerm.paymentCadence` enum (monthly|quarterly|annual) +
   form select.
3. `ContractTerm.minimumPurchaseCommitment Decimal?` + form input on
   usage-side tie-in contracts.

## Wave C — shortfall + projections
1. `ContractTerm.shortfallHandling` enum (bill_immediately |
   carry_forward) + form select + detail banner.
2. Run-rate projection card on detail page — project end-of-term
   capital balance given trailing-90-day rebate velocity.

## Constraints per wave

- `bunx tsc --noEmit` → 0 errors before commit
- New tests for the new logic (engine + server action)
- Schema changes use `bun run db:push` (no migrations in this project)
- Don't touch engine code — Wave A/B/C are wiring + thin additions.
  The engine already supports cadence, down-payment start balance,
  and shortfall policy.
