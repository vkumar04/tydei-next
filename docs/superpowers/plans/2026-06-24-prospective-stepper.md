# Vendor Prospective → guided stepper (2026-06-24)

Restructure the vendor Prospective area from 6 loosely-coupled tabs into a
guided **Proposals stepper** that flows usage → pricing → opportunity → report,
so a deal is built once and analyzed end-to-end (Vick 2026-06-24). Fixes the
"Analyze deal doesn't use the uploaded usage" disconnect.

## Confirmed decisions (AskUserQuestion 2026-06-24)

1. **Collapse** Deal Scorer + Opportunity Engine into the Proposals stepper.
   New tab bar: **Opportunities (list) · Proposals (stepper) · Benchmarks**.
2. **Usage auto-populates the construct rows** — each product in the uploaded
   12-mo usage becomes a row pre-filled with current price + annual volume;
   the user adds Floor/Target/Ask. Proposed-pricing file matches usage by SKU.
3. **Optional current-contract pricing file** (compare proposed vs current
   contract, distinct from usage's paid price) + **one unified exportable
   report** (deal score + penetration + benchmarks + DCF).

## Clarifications captured (answered to the user)
- **Target / Floor margin %** = vendor-side gross-margin targets
  (`(price − internalUnitCost) / price`); not facility-side.
- **Current / Target share %** = vendor market share at the facility (drives the
  penetration card, not margin).

## Target architecture

`prospective-client.tsx` becomes: **Opportunities | Proposals | Benchmarks**.

- **Opportunities** = list of past proposals (reuse `ProposalCards`-style list /
  My-Contracts pattern). Selecting one opens it in the stepper (read/continue).
- **Proposals** = a `<ProposalStepper>` with 3 steps (all entries optional;
  Next is always enabled):
  - **Step 1 — Usage & Pricing**: upload Usage History (auto-populates rows via
    `usageRowsToConstructs`), upload Proposed Pricing (matched to usage by SKU →
    fills Ask/Target), optional **Current Contract** file (fills a "contract
    price" column). Editable construct grid (Current/Floor/Target/Ask/Volume/
    Rebate + benchmark Avg/P25–P75 inline). Margin/COGS inputs live here.
  - **Step 2 — Opportunity Engine**: pick facility → if connected, load its
    Facility Current State; division + all levers (price change, target share,
    volume growth) seeded from Step 1's blended deal. Benchmarks loaded.
  - **Step 3 — Analysis & Report**: runs `getVendorProspectiveAnalysis` over the
    blended constructs + the opportunity scenario, renders the scorecard +
    penetration + benchmark position, and a single **Export** (unify
    `export-opportunity.ts` + the deal scorecard).
- **Benchmarks** = standalone tab (uploaded-only) + the deal-scorer benchmark
  compare action folded in.

## Data flow (the "use the usage" fix)
- Usage rows → `usageRowsToConstructs(rows)`: group by normalized SKU →
  `{ productName, current: avg unit cost, annualVolume: Σ qty, benchmarkId? }`.
- Proposed-pricing rows → match by SKU → set `ask`/`target`.
- Current-contract rows → match by SKU → set a `contractPrice` reference column.
- `blendConstructsToScenarios` (existing) → Floor/Target/Ask scenarios + Current
  baseline → `getVendorProspectiveAnalysis`. Now driven by REAL usage.

## PR sequence (each a working slice)
1. **Usage → constructs core** (pure `usageRowsToConstructs` + SKU match helpers
   + tests). De-risks the central fix. *(start here)*
2. **Step 1 surface**: merge the proposal-builder uploads + the construct grid
   into one "Usage & Pricing" panel; wire usage auto-populate.
3. **Stepper shell + tab restructure**: `<ProposalStepper>`, Opportunities→list,
   collapse Deal Scorer + Opp Engine tabs into steps; Benchmarks standalone.
4. **Step 2**: facility-connected data load + levers seeded from Step 1.
5. **Step 3 + unified export**: analysis + one report.

## Verify (per PR)
- `tsc` · vitest (pure helpers get unit tests) · build · browser-smoke the step.
- Keep `blendConstructsToScenarios` + the analyzer untouched (already tested).
