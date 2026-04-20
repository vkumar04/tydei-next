# Tie-In Capital — Contract-Level Implementation Plan

**Spec:** `docs/superpowers/specs/2026-04-19-tie-in-capital-contract-level-design.md`
**Goal:** Move 6 capital fields from `ContractTerm` to `Contract`. One capital entry, all rebates across all terms pay it down.

## Phase 0 — Read current state (no code)

- `prisma/schema.prisma` — `Contract` (~line 596), `ContractTerm` (~line 690), `ContractAmortizationSchedule` (~754).
- `lib/actions/contracts/tie-in.ts` — `getContractCapitalSchedule` (208), `getContractCapitalProjection` (420). Note: `rebate.aggregate({ where: { contractId } })` at line 493 is already contract-level ✅.
- `components/contracts/contract-terms-entry.tsx` — Section A capital block starts ~line 587.
- `components/contracts/edit-contract-client.tsx` — line 161 copies capitalCost per-term.
- `components/contracts/contract-detail-client.tsx` — lines 543, 882 reference `contract.terms[0].capitalCost`.

## Phase 1 — Schema + migration script

1. Edit `prisma/schema.prisma`:
   - On `Contract`, add:
     ```prisma
     capitalCost        Decimal?          @db.Decimal(14, 2)
     interestRate       Decimal?          @db.Decimal(6, 4)
     termMonths         Int?
     downPayment        Decimal?          @db.Decimal(14, 2)
     paymentCadence     PaymentCadence?
     amortizationShape  AmortizationShape @default(symmetrical)
     ```
   - Leave `ContractTerm` capital fields in place **for now** — we need them to read during migration.
2. `bun run db:push` — adds the new columns (non-destructive).
3. Write `scripts/migrate-capital-to-contract-level.ts`:
   ```ts
   import { prisma } from "@/lib/db"
   async function main() {
     const contracts = await prisma.contract.findMany({
       where: { terms: { some: { capitalCost: { not: null } } } },
       include: {
         terms: {
           where: { capitalCost: { not: null } },
           orderBy: { createdAt: "asc" },
         },
       },
     })
     let migrated = 0
     for (const c of contracts) {
       const src = c.terms[0]
       if (!src) continue
       if (c.terms.length > 1) {
         console.warn(
           `[multi-capital] contract=${c.id} has ${c.terms.length} capital terms — using first (${src.id})`,
         )
       }
       await prisma.contract.update({
         where: { id: c.id },
         data: {
           capitalCost: src.capitalCost,
           interestRate: src.interestRate,
           termMonths: src.termMonths,
           downPayment: src.downPayment,
           paymentCadence: src.paymentCadence,
           amortizationShape: src.amortizationShape,
         },
       })
       migrated++
     }
     console.log(`Migrated capital for ${migrated} contracts.`)
   }
   main().then(() => process.exit(0))
   ```
4. Run migration: `bun scripts/migrate-capital-to-contract-level.ts`.
5. Now edit `prisma/schema.prisma`:
   - **Remove** `capitalCost`, `interestRate`, `termMonths`, `downPayment`, `paymentCadence`, `amortizationShape` from `ContractTerm`.
   - **Drop** `termId` from `ContractAmortizationSchedule` (remove FK, change `@@unique([termId, periodNumber])` → `@@unique([contractId, periodNumber])`). Keep the relation to `term` out entirely; remove the `term.amortizationRows` back-relation too.
6. `bun run db:push --accept-data-loss` — drops the term columns + termId column.

**Commit after Phase 1:** `feat(schema): move tie-in capital fields from ContractTerm to Contract (one-shot migration)`

## Phase 2 — Read path (server actions)

1. `lib/actions/contracts/tie-in.ts`:
   - `getContractCapitalSchedule` — change the `findFirst` to select capital fields on the contract itself, drop the `terms` sub-select. Read `contract.capitalCost` etc.
   - `getContractCapitalProjection` — same. The `rebate.aggregate({ where: { contractId } })` stays unchanged.
   - `ContractAmortizationSchedule` reads: drop `termId` references; `amortizationRows` relation now lives on `Contract` directly — so query `prisma.contractAmortizationSchedule.findMany({ where: { contractId } })`.
2. `lib/actions/contracts.ts` — `updateContract`, `createContract`: add the 6 capital fields to the contract create/update data. Remove them from the per-term payload mapping.
3. `lib/validators/contract-terms.ts` — drop the 6 capital fields from the term Zod schema.
4. New file `lib/validators/contract-capital.ts`:
   ```ts
   import { z } from "zod"
   export const contractCapitalSchema = z.object({
     capitalCost: z.number().nullable(),
     interestRate: z.number().nullable(),
     termMonths: z.number().int().nullable(),
     downPayment: z.number().nullable(),
     paymentCadence: z.enum(["monthly", "quarterly", "annual"]).nullable(),
     amortizationShape: z.enum(["symmetrical", "custom"]).default("symmetrical"),
   })
   export type ContractCapital = z.infer<typeof contractCapitalSchema>
   ```
5. Run `bunx prisma generate`, then `bunx tsc --noEmit` — fix every reference that still reads `term.capitalCost` etc.

**Commit:** `feat(tie-in): read capital from Contract row, not ContractTerm`

## Phase 3 — UI

1. Create `components/contracts/contract-capital-entry.tsx`:
   - Props: `{ capital: ContractCapital; onChange: (patch: Partial<ContractCapital>) => void; effectiveDate?: Date | null }`.
   - Copy the "Section A — Capital Terms" markup out of `contract-terms-entry.tsx` (inputs for capitalCost, interestRate, termMonths, downPayment, paymentCadence dropdown, amortizationShape toggle).
   - Include the empty-state nudge ("New to tie-in contracts?").
   - Render `<TieInAmortizationPreview capitalCost={…} interestRate={…} termMonths={…} downPayment={…} period={…} />` inline.
2. Edit `components/contracts/contract-terms-entry.tsx`:
   - **Delete** the Section A block (Capital Terms header + inputs + empty-state nudge, approximately lines 571-700).
   - Delete the inline `<TieInAmortizationPreview>` (it now lives in the new entry component).
   - Each term accordion keeps only rebate-term fields (name, baseline, evaluation period, tiers, minimumPurchaseCommitment, shortfallHandling, categories).
3. Edit `components/contracts/edit-contract-client.tsx`:
   - Lift capital state to the root-level contract state (new `capital` object).
   - Render `<ContractCapitalEntry capital={capital} onChange={patch => setCapital(c => ({...c, ...patch}))} effectiveDate={…} />` **above** the terms list.
   - Remove capital fields from the term state / onChange mapping.
   - Submit: include capital fields in the `updateContract` payload.
4. Edit `components/contracts/contract-detail-client.tsx`:
   - `contract.terms.some((t) => t.capitalCost != null)` → `contract.capitalCost != null`.
   - `contract.terms[0].capitalCost` → `contract.capitalCost`.
5. Edit `components/contracts/contract-amortization-card.tsx` and `contract-capital-projection-card.tsx` — same pattern (read from contract, not terms[0]).

**Commit:** `feat(tie-in): single capital-entry card at contract level; drop per-term capital UI`

## Phase 4 — Test updates

1. `lib/actions/contracts/__tests__/tie-in.test.ts` — fixtures: move capital to contract shape.
2. `lib/actions/__tests__/capital-projection.test.ts` — same.
3. Any fixture in `lib/rebates/__tests__` or `components/contracts/__tests__` that builds a term with `capitalCost` — move to contract.
4. `bunx vitest run` — all green.

## Phase 5 — Verify

1. `bunx tsc --noEmit` — 0 errors.
2. `bunx vitest run` — all pass.
3. Manually create a tie-in contract with TWO rebate terms → capital entry appears once above the terms → amortization preview renders → save → detail page shows one capital card, two rebate terms → logging rebates against either term reduces the one capital balance.

## Phase 6 — Commit

Each phase gets its own commit. Final sequence on main:

1. `feat(schema): move tie-in capital to Contract (one-shot migration)`
2. `feat(tie-in): read capital from Contract, not ContractTerm`
3. `feat(tie-in): single capital-entry card at contract level`
4. `test(tie-in): update fixtures to contract-level capital`
