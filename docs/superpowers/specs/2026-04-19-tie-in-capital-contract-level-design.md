# Tie-In Capital at the Contract Level — Design

**Date:** 2026-04-19
**Source:** Charles W1.T (screenshot — capital fields appearing on every ContractTerm)

## Problem

Tie-in capital (cost, interest, term months, down payment, cadence, amortization shape) is stored on `ContractTerm`. A contract with multiple rebate terms (e.g., "Qualified Annual Spend Rebate" + "Distal Extremities Rebate") makes the user fill capital fields on each term. Real-world tie-in: **one capital asset per contract**, rebates earned on any term pay down that single balance.

## Rule (locked)

1. Capital is **contract-level**: cost, interest rate, term months, down payment, cadence, amortization shape live on `Contract`.
2. **One** amortization schedule per contract (keyed by `contractId` only).
3. Rebate paydown already aggregates across all terms via `rebate.aggregate({ where: { contractId } })` in `getContractCapitalProjection` — keep that behavior; it's correct.
4. **One-shot migration**: for each contract with per-term capital, copy the first non-null term's values to `Contract`, drop the columns from `ContractTerm` after code switches over.

## Schema

**Add to `Contract`:**
```prisma
capitalCost        Decimal?          @db.Decimal(14, 2)
interestRate       Decimal?          @db.Decimal(6, 4)
termMonths         Int?
downPayment        Decimal?          @db.Decimal(14, 2)
paymentCadence     PaymentCadence?   // nullable so non-tie-in contracts stay null
amortizationShape  AmortizationShape @default(symmetrical)
```

**Remove from `ContractTerm`:** `capitalCost`, `interestRate`, `termMonths`, `downPayment`, `paymentCadence`, `amortizationShape`.

Keep `paymentTiming` on `ContractTerm` — that's the rebate-evaluation cadence (separate concern from capital payment cadence). Keep `minimumPurchaseCommitment` on `ContractTerm` (per-term commitment is real).

**`ContractAmortizationSchedule`:** drop `termId` column. Unique key becomes `(contractId, periodNumber)`.

## Migration

One-shot TS script (`scripts/migrate-capital-to-contract-level.ts`):
1. For each `Contract`, pick the first `ContractTerm` (orderBy createdAt asc) with `capitalCost != null`. Copy its 6 fields to the contract row.
2. If multiple terms have capital, log a WARNING with the contract ID but still use the first term's values.
3. Null out the per-term capital columns (done implicitly when the columns are dropped post-migration).
4. Move `ContractAmortizationSchedule` rows: identical rows per-term already existed per-contract so this should be a no-op dedupe — just drop the `termId` FK.

Migration runs before the column drop. Then `bun run db:push` drops the term columns.

## Server-action changes

- `lib/actions/contracts/tie-in.ts` — `getContractCapitalSchedule`, `getContractCapitalProjection`: read capital fields from `contract`, not `contract.terms[0]`. The `rebate.aggregate` query keyed by `contractId` stays unchanged (already contract-level).
- `lib/actions/contracts.ts` — `createContract` / `updateContract` accept the 6 capital fields on the contract payload.
- `lib/validators/contract-terms.ts` — drop capital fields from term schema.
- New `lib/validators/contract-capital.ts` — Zod for the 6 capital fields.

## UI

- **New file** `components/contracts/contract-capital-entry.tsx` — renders once above the terms list, wraps the 6 capital fields + the inline amortization preview (`tie-in-amortization-preview.tsx` unchanged).
- `components/contracts/contract-terms-entry.tsx` — **delete** "Section A — Capital Terms" from every term accordion.
- `components/contracts/edit-contract-client.tsx` — lift capital state from term array to contract state.
- `components/contracts/contract-detail-client.tsx` — `contract.terms[0].capitalCost` → `contract.capitalCost`. Same for the amortization / capital projection cards.
- `components/contracts/contract-amortization-card.tsx`, `contract-capital-projection-card.tsx` — read from contract.

## Tests to update

- `lib/actions/contracts/__tests__/tie-in.test.ts` — fixtures move capital to contract.
- `lib/actions/__tests__/capital-projection.test.ts` — same.
- Any fixture that builds a term with `capitalCost` — move to contract.

## Rollout

One-shot. No dual-read. Migration script runs once, columns drop, UI switches in a single commit series. Charles is the only live tester and wants the clean model.
