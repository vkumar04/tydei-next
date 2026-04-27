# 2026-04-26 — Source-level oracle design (spec)

**Status:** draft / pre-plan
**Author:** session w/ Vick on 2026-04-26
**Trigger:** while reviewing the engine-input-level oracles that just shipped,
Vick said:
> "Look this app is just a fancy calculator"
> "The source is a contract pdf and pricing file that's the input"

That reframes what an oracle should be. Today's oracles operate at the
*engine-input* layer (already-bucketed monthly spend, already-extracted tier
ladder). The next layer up — the layer Vick described — is the **source layer:
contract spec + pricing file are the canonical inputs**, the entire app
pipeline is the calculator under test, and the oracle compares the calculator's
output to an independent recompute *from the same source*.

This spec defines the architecture for that next-layer oracle. Plan #1
(`oracle-runner-skeleton.md`) and Plan #2 (`oracle-coverage-batch.md`) shipped
the framework + four engine-input oracles; this is Plan #3.

## 1. Why this layer matters

Engine-input oracles catch math drift inside a helper — e.g.,
`computeCategoryMarketShare` returns the same number as an inline recompute
when given the same `rows[] + contractCategoryMap`. They don't catch:

- **Importer bugs**: pricing-file rows being dropped, miscategorized, or
  matched to the wrong contract.
- **Recompute pipeline drift**: a contract is created → pricing seeded → COG
  imported → `recomputeMatchStatusesForVendor` runs → the persisted
  `Rebate.rebateEarned` doesn't equal what the engine projected.
- **Cross-cutting plumbing**: a fix to `computeCategoryMarketShare` lands
  cleanly but the contract-detail page renders a different number because
  the action wraps it in a transformation that drifted.
- **End-to-end shape**: "given THIS contract PDF and THIS pricing CSV,
  the contract-detail page MUST show $X earned and $Y collected."

The existing `scripts/verify-app-against-oracle.ts` solves this for ONE case
(Charles's Arthrex CSV + XLSX, hardcoded demo facility, hardcoded oracle
expectations). It's load-bearing — it caught the W2.A.x BLOCKER class — but
it's a fork-and-rename per scenario today.

The goal of this spec: turn that one-off into a parameterized harness so we
can have N scenarios with one shared runner.

## 2. What "source level" means

A scenario provides three things, in order of canonicality:

1. **Contract spec** (data, not necessarily a PDF). The contract's metadata —
   number, name, dates, type, vendor name, facility name, tiered terms,
   capital line items, market-share commitments. Could come from a PDF
   extraction or hand-written JSON; the harness doesn't care.
2. **Pricing file** (rows). Each row: `vendorItemNo`, `unitCost`,
   `manufacturer`, optional category, optional carve-out percent.
3. **COG file** (rows). Each row: `vendorItemNo`, `quantity`, `unitCost`,
   `extendedPrice`, `transactionDate`, optional `category`.

The harness drives those through the actual app pipeline:
- Create the contract via `prisma.contract.create` (or via a server action).
- Seed `ContractPricing` rows from the pricing file.
- Bulk-import the COG file via `bulkImportCOGRecords`.
- Run `recomputeMatchStatusesForVendor` + accrual recompute.
- Read every customer-facing number the contract-detail page would render.
- Compare to the scenario's `expectations` block.

Then **roll back** so the demo DB stays clean.

## 3. Proposed shape

### 3.1 Scenario file

```ts
// scripts/oracles/source/_scenarios/arthrex-canonical.ts
import { defineScenario } from "../_shared/scenario"

export default defineScenario({
  name: "arthrex-canonical",
  description: "Charles's exact 2026-04-22 Arthrex bundle",

  facility: { name: "Lighthouse Surgical Center" },

  contract: {
    contractNumber: "ART-2024-001",
    name: "Arthrex Master Agreement",
    vendorName: "Arthrex",
    contractType: "usage",
    effectiveDate: "2024-01-01",
    expirationDate: "2026-12-31",
    totalValue: 1_000_000,
    annualValue: 333_333,
    terms: [
      {
        termName: "Spend Rebate",
        termType: "spend_rebate",
        appliesTo: "all_products",
        evaluationPeriod: "annual",
        paymentTiming: "annual",
        tiers: [
          { tierNumber: 1, spendMin: 0,        rebateValue: 0.02 },
          { tierNumber: 2, spendMin: 250_000,  rebateValue: 0.03 },
          { tierNumber: 3, spendMin: 500_000,  rebateValue: 0.04 },
        ],
      },
    ],
  },

  pricingRows: [
    // Either inline JSON for small fixtures, or a path to a CSV/XLSX
    // checked into fixtures/oracle/ for big ones.
    { vendorItemNo: "AR-1234", unitCost: 1499.00, category: "Arthroscopy" },
    // ...
  ],

  cogRows: [
    { vendorItemNo: "AR-1234", quantity: 5, unitCost: 1499.00, extendedPrice: 7495, transactionDate: "2024-03-15" },
    // ...
  ],

  expectations: {
    // Numbers the contract-detail page MUST render for this contract
    // after import + recompute. Sourced from an independent oracle
    // (the Python script for Charles's case; hand-computed for synthetic).
    onContractSpend:  4075.00,
    offContractSpend: 531_400.00,
    rebateEarnedLifetime:  0,
    rebateCollected:       0,
    marketSharePctByCategory: {
      "Arthroscopy": 95.5,
    },
  },
})
```

### 3.2 Scenario runner

```ts
// scripts/oracles/source/_shared/scenario.ts
export interface Scenario {
  name: string
  facility: { name: string }
  contract: ContractSpec
  pricingRows: PricingRow[]
  cogRows: CogRow[]
  expectations: Expectations
}

export function defineScenario(spec: Scenario): Scenario {
  return spec
}

/** Run a scenario through the real app pipeline inside a transaction;
 *  every write is rolled back. Returns the actual values the
 *  contract-detail page would render. */
export async function runScenario(scenario: Scenario): Promise<Actuals> {
  return prisma.$transaction(async (tx) => {
    // 1. Resolve facility + vendor
    // 2. Create contract + terms + tiers
    // 3. Seed pricing
    // 4. Bulk-import COG (use the real importer)
    // 5. Run recompute pipeline
    // 6. Read all customer-facing aggregates via the canonical helpers
    //    (sumEarnedRebatesLifetime, sumCollectedRebates,
    //    computeCategoryMarketShare, etc.)
    // 7. Throw at end of tx so everything rolls back
  }, { isolationLevel: "Serializable", maxWait: 60_000, timeout: 60_000 })
}
```

The transaction-rollback pattern lets every scenario be **non-destructive** —
it can run against staging or even prod without leaving residue.

### 3.3 Harness oracle

```ts
// scripts/oracles/source-scenarios.ts
import { defineOracle } from "../_shared/runner"
import { runScenario } from "./source/_shared/scenario"
import arthrexCanonical from "./source/_scenarios/arthrex-canonical"
import strykerTieIn from "./source/_scenarios/stryker-tie-in"
import medtronicCarveOut from "./source/_scenarios/medtronic-carve-out"

const SCENARIOS = [arthrexCanonical, strykerTieIn, medtronicCarveOut]

export default defineOracle("source-scenarios", async (ctx) => {
  for (const s of SCENARIOS) {
    const actuals = await runScenario(s)
    for (const [key, expected] of Object.entries(s.expectations)) {
      const actual = actuals[key as keyof typeof actuals]
      ctx.check(
        `[${s.name}] ${key} matches expected`,
        Math.abs(Number(actual) - Number(expected)) < 0.01,
        `expected=${expected} actual=${actual}`,
      )
    }
  }
})
```

This is one new oracle file. The runner already discovers it; no changes to
`index.ts` or any other plumbing.

## 4. Migration of existing `verify-app-against-oracle.ts`

The script becomes the FIRST scenario:

- Hardcoded paths → fixture file references in
  `fixtures/oracle/arthrex-canonical/{pricing.xlsx,cog.csv}`.
- Hardcoded `ORACLE` constants → `expectations` block on the scenario.
- `loadPricingItems` (XLSX parser) → reusable in `_shared/load-fixture.ts`
  for any scenario that uses an XLSX file.
- The Python oracle (`oracle_charles_arthrex.py`) keeps generating the
  ground-truth numbers — humans (or a one-time TS port) freeze its output as
  the `expectations` constants.

After migration, the script is deleted (or kept as a thin shim that re-runs
just the one scenario).

## 5. What this catches that engine-input oracles don't

- **Importer drift**: pricing CSV row mapping to ContractPricing rows.
- **Match-pipeline drift**: COG → contract pairing via `recomputeMatchStatusesForVendor`.
- **Accrual pipeline drift**: contract terms + matched COG → persisted Rebate rows.
- **Aggregate-display drift**: action wraps + serializers + UI components.
- **Cross-cutting bugs**: a fix to one helper that subtly breaks another,
  caught only by checking the entire downstream flow.

Plus everything the engine-input oracles already catch — because the source
scenarios exercise the same engines as a side effect.

## 6. Sequencing (3 plans on top of this spec)

1. ~~**`source-oracle-harness.md`**~~ — DONE 2026-04-26. Harness +
   cleanup-by-name (NOT tx-rollback — `bulkImportCOGRecords` uses the
   global Prisma client, see Risks §7) + first synthetic scenario.
   Smoke run on local DB: 2/2 PASS in 274ms with zero residue.
   `_recomputeAccrualForContractWithFacility` extracted from
   `recomputeAccrualForContract` so the harness can call recompute
   without going through `requireFacility`. Migration of
   `scripts/verify-app-against-oracle.ts` deferred to Plan #2 because
   of XLSX-loader complexity.
2. ~~**`source-oracle-fixture-loaders.md`**~~ — DONE 2026-04-26. CSV
   loaders + `fixtures/oracle/` convention + README. XLSX deferred
   (only consumer is the deferred `verify-app-against-oracle.ts`
   migration).
3. ~~**`source-oracle-coverage-fill.md`**~~ — DONE 2026-04-26. Four new
   scenarios: tie-in-capital, carve-out, market-share-commitment,
   growth-rebate. Live smoke: 9/9 checks across 5 scenarios. Surfaced
   one real finding (tie-in auto-collects rebates — root cause
   investigation deferred).

## 7. Tradeoffs / risks

- **Slower oracle runs**: source-level scenarios drive Prisma writes inside
  a tx. Per-scenario time budget: ~1-3 seconds (vs ~70ms for engine-input
  oracles). Fine for nightly CI, slower than the `bun run oracles` ad-hoc
  loop.
- **Rollback isolation**: If the importer commits OUTSIDE the test
  transaction (e.g., sub-transactions, raw SQL), rollback won't revert
  those writes. We need to audit `bulkImportCOGRecords` to confirm it's
  fully tx-bound; if not, the harness needs an explicit cleanup step.
- **Fixture maintenance**: if the seed schema changes (new required field
  on Contract, etc.), every scenario file needs an update. Centralizing
  the spec→Prisma mapping in `runScenario` means a one-place fix instead
  of N.
- **Demo-DB pollution risk**: a buggy scenario or a tx-bypass means writes
  leak. Mitigation: every scenario name gets prefixed with
  `[ORACLE-<scenario>]` so any leaks are easy to grep and clean.
- **Cross-platform paths**: the existing script hardcodes
  `/Users/vickkumar/Desktop/...`. Plan #2 in the sequencing fixes this
  with env-var-overridable fixture paths and a `fixtures/oracle/` dir
  for repo-checked-in cases.

## 8. Out of scope for this spec

- **PDF extraction itself.** A scenario provides extracted contract DATA;
  generating that data from a PDF is a separate problem (and one the AI
  extract action already handles for the production app).
- **Multi-facility scenarios.** Each scenario targets one facility.
  Cross-facility scenarios are a follow-up if needed.
- **Replay-against-prod.** Running source scenarios against prod would
  require even stricter rollback isolation. Defer.

## 9. Connections to other specs

- **`2026-04-26-oracle-promotion-design.md`** §2.1 coverage gaps: every
  remaining gap (carve-out, accrual ledger, vendor-market-share,
  volume-CPT) becomes a source-level scenario instead of an engine-input
  oracle. Source-level subsumes engine-input for surfaces that have an
  end-to-end pipeline.
- **`2026-04-26-v0-parity-engines-design.md`**: source scenarios are the
  ultimate parity test. If the canonical helper is right, the parity test
  passes, AND the source scenario produces the expected number, all three
  layers agree.
- **`2026-04-20-engine-improvement-roadmap.md`**: engine improvements ship
  faster when source scenarios exist — the scenario is the regression
  test for the change.
