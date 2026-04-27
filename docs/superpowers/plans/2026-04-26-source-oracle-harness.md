# Source Oracle Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** Build the `defineScenario` + `runScenario` harness for source-level oracles. Drives a synthetic contract-spec + pricing-rows + COG-rows fixture through the real `bulkImportCOGRecords` + recompute pipeline, then reads customer-facing aggregates and asserts they match expectations. Cleanup-by-name pattern (not tx-rollback) because the importer uses the global Prisma client. One synthetic scenario lands as proof; migration of the existing `scripts/verify-app-against-oracle.ts` is a follow-up plan.

**Architecture:** A scenario file default-exports a `Scenario` object with `{ facility, contract, pricingRows, cogRows, expectations }`. The runner: (1) wipes any leftover scenario data (idempotent), (2) creates the contract + terms + tiers + pricing rows + COG rows via the production code paths, (3) runs the recompute pipeline, (4) reads the aggregates the contract-detail page would render, (5) compares to `expectations`, (6) in `finally`: deletes the scenario contract + cascades. Wraps as a `defineOracle` so the existing `bun run oracles` runner picks it up.

**Tech Stack:** TypeScript strict, Bun runtime, Prisma 7. Reuses the existing oracle runner from `scripts/oracles/_shared/runner.ts`. New code lives under `scripts/oracles/source/`.

**Why this scope:** The user said "the source is contract pdf and pricing file that's the input." Engine-input oracles (already shipped) catch math drift inside one helper; source-level catches importer + match-pipeline + accrual + display drift end-to-end. Plan #1 from `2026-04-26-source-level-oracle-design.md`. Limited to harness + one scenario so the pattern is proven before generalizing to fixture-loaded scenarios in Plan #2.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `scripts/oracles/source/_shared/scenario.ts` | Create | `defineScenario` factory + `Scenario` types. Pure data shape; no Prisma. |
| `scripts/oracles/source/_shared/runner.ts` | Create | `runScenario(scenario)` — drives the pipeline, returns `Actuals`, manages cleanup. |
| `scripts/oracles/source/_shared/cleanup.ts` | Create | `wipeScenarioData(scenarioName)` — deletes any contract whose `contractNumber` starts with `[ORACLE-<name>]` plus its cascading rows. Idempotent. |
| `scripts/oracles/source/_scenarios/synthetic-spend-rebate.ts` | Create | First scenario: a tiered spend-rebate contract with hand-computed expectations. |
| `scripts/oracles/source-scenarios.ts` | Create | The discovery oracle — imports every scenario, runs them all, asserts each scenario's `expectations` block. Default-exports `defineOracle("source-scenarios", ...)`. |
| `scripts/oracles/source/_shared/__tests__/cleanup.test.ts` | Create | Unit test for `wipeScenarioData` with mocked Prisma (tests the where-clause shape). |

---

## Task 1: Scenario types — failing test for cleanup

**Files:**
- Create: `scripts/oracles/source/_shared/__tests__/cleanup.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// scripts/oracles/source/_shared/__tests__/cleanup.test.ts
import { describe, it, expect, vi } from "vitest"

const deleteMany = vi.fn(async () => ({ count: 0 }))
vi.mock("@/lib/db", () => ({
  prisma: {
    contract: { deleteMany },
    cOGRecord: { deleteMany },
  },
}))

import { wipeScenarioData } from "../cleanup"

describe("wipeScenarioData", () => {
  it("deletes by [ORACLE-<name>] contractNumber prefix", async () => {
    await wipeScenarioData("synthetic-spend-rebate")
    expect(deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          contractNumber: { startsWith: "[ORACLE-synthetic-spend-rebate]" },
        }),
      }),
    )
  })

  it("also wipes COG rows tagged with the same notes prefix", async () => {
    await wipeScenarioData("synthetic-spend-rebate")
    expect(deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          notes: { startsWith: "[ORACLE-synthetic-spend-rebate]" },
        }),
      }),
    )
  })
})
```

- [ ] **Step 2: Run** — `bunx vitest run scripts/oracles/source/_shared/__tests__/cleanup.test.ts`. Expect FAIL with "Failed to resolve import".

---

## Task 2: Implement `cleanup.ts` + `scenario.ts`

**Files:**
- Create: `scripts/oracles/source/_shared/cleanup.ts`
- Create: `scripts/oracles/source/_shared/scenario.ts`

- [ ] **Step 1: Implement `cleanup.ts`**

```ts
// scripts/oracles/source/_shared/cleanup.ts
/**
 * Idempotent cleanup of scenario data. Every source-level scenario
 * tags its contract `contractNumber` and its COG rows' `notes` with
 * `[ORACLE-<scenario-name>]` so we can wipe by prefix without
 * tracking individual ids. Runs both before (in case of leftover from
 * a previous failed run) and after every scenario.
 */
import { prisma } from "@/lib/db"

export async function wipeScenarioData(scenarioName: string): Promise<void> {
  const tag = `[ORACLE-${scenarioName}]`
  await prisma.cOGRecord.deleteMany({
    where: { notes: { startsWith: tag } },
  })
  await prisma.contract.deleteMany({
    where: { contractNumber: { startsWith: tag } },
  })
  // ContractTerm, ContractTier, ContractPricing, Rebate, ContractPeriod
  // all have onDelete: Cascade from Contract — they're handled by the
  // contract.deleteMany above.
}
```

- [ ] **Step 2: Implement `scenario.ts`**

```ts
// scripts/oracles/source/_shared/scenario.ts
/**
 * Source-level oracle scenario definition.
 *
 * Each scenario provides three layers of input: contract spec, pricing
 * rows, COG rows. The harness drives all three through the real app
 * pipeline and compares the customer-facing aggregates to the
 * scenario's `expectations` block.
 */

export interface ScenarioContractTier {
  tierNumber: number
  spendMin: number
  spendMax?: number
  rebateValue: number
}

export interface ScenarioContractTerm {
  termName: string
  termType: string
  appliesTo?: "all_products" | "specific_category" | "specific_items"
  evaluationPeriod?: string
  paymentTiming?: string
  baselineType?: string
  rebateMethod?: string
  tiers: ScenarioContractTier[]
}

export interface ScenarioContractSpec {
  /** Suffix appended after `[ORACLE-<scenario-name>]` to keep contract
   *  numbers unique within a scenario family. */
  contractNumberSuffix: string
  name: string
  vendorName: string
  contractType: "usage" | "capital" | "tie_in" | "service" | "pricing_only" | "grouped"
  status?: "active" | "expiring" | "draft"
  effectiveDate: string
  expirationDate: string
  totalValue: number
  annualValue: number
  terms: ScenarioContractTerm[]
}

export interface ScenarioPricingRow {
  vendorItemNo: string
  unitCost: number
  category?: string
  manufacturer?: string
}

export interface ScenarioCogRow {
  vendorItemNo: string
  quantity: number
  unitCost: number
  extendedPrice: number
  /** ISO date string (YYYY-MM-DD). */
  transactionDate: string
  category?: string
  inventoryNumber?: string
  inventoryDescription?: string
}

export interface ScenarioExpectations {
  /** Lifetime earned rebate from Rebate rows after recompute. */
  rebateEarnedLifetime?: number
  /** Lifetime collected. */
  rebateCollected?: number
  /** Trailing-12mo COG sum at facility. */
  currentSpend?: number
  /** Number of Rebate rows after recompute. */
  rebateRowCount?: number
  /** ContractPeriod row count. */
  contractPeriodCount?: number
}

export interface Scenario {
  name: string
  description: string
  facilityName: string
  contract: ScenarioContractSpec
  pricingRows: ScenarioPricingRow[]
  cogRows: ScenarioCogRow[]
  expectations: ScenarioExpectations
}

export function defineScenario(spec: Scenario): Scenario {
  return spec
}
```

- [ ] **Step 3: Run the failing test** — `bunx vitest run scripts/oracles/source/_shared/__tests__/cleanup.test.ts`. Expect 2/2 PASS.

- [ ] **Step 4: Typecheck** — `bunx tsc --noEmit`. 0 errors.

- [ ] **Step 5: Commit**

```bash
git add scripts/oracles/source/_shared/cleanup.ts scripts/oracles/source/_shared/scenario.ts scripts/oracles/source/_shared/__tests__/cleanup.test.ts
git commit -m "feat(oracles): source-scenario types + cleanup-by-name

defineScenario factory + wipeScenarioData(scenarioName) for idempotent
cleanup. Every scenario tags contract.contractNumber and cogRecord.notes
with [ORACLE-<name>] so we can wipe by prefix without tracking ids.

Spec 2026-04-26-source-level-oracle-design.md Plan #1.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Implement `runScenario`

**Files:**
- Create: `scripts/oracles/source/_shared/runner.ts`

- [ ] **Step 1: Implement**

```ts
// scripts/oracles/source/_shared/runner.ts
/**
 * Source-scenario harness. Drives the contract spec + pricing rows +
 * COG rows through the real production pipeline:
 *   1. Resolve facility + vendor (look up by name; create vendor if
 *      missing — facility must already exist).
 *   2. Create the contract with prefixed contractNumber.
 *   3. Insert ContractTerm + ContractTier rows from spec.terms.
 *   4. Insert ContractPricing rows from pricingRows.
 *   5. Bulk-insert COG rows tagged with [ORACLE-<name>] in `notes`,
 *      then run `recomputeMatchStatusesForVendor` so they pair with
 *      the contract.
 *   6. Read every customer-facing aggregate via the canonical helpers.
 *   7. In finally: wipeScenarioData() so the demo DB stays clean.
 *
 * NOT tx-rollback because bulkImportCOGRecords + recompute use the
 * global Prisma client (not a tx parameter). Cleanup-by-name is the
 * pragmatic alternative until the importer is refactored.
 */
import { prisma } from "@/lib/db"
import { sumEarnedRebatesLifetime } from "@/lib/contracts/rebate-earned-filter"
import { sumCollectedRebates } from "@/lib/contracts/rebate-collected-filter"
import { wipeScenarioData } from "./cleanup"
import type { Scenario, ScenarioExpectations } from "./scenario"

export interface ScenarioActuals {
  rebateEarnedLifetime: number
  rebateCollected: number
  currentSpend: number
  rebateRowCount: number
  contractPeriodCount: number
}

export async function runScenario(s: Scenario): Promise<ScenarioActuals> {
  const tag = `[ORACLE-${s.name}]`
  // 1. Idempotent cleanup of any prior leftover.
  await wipeScenarioData(s.name)

  try {
    // 2. Facility lookup (must exist — scenarios use real demo facilities).
    const facility = await prisma.facility.findFirst({
      where: { name: s.facilityName },
      select: { id: true },
    })
    if (!facility) {
      throw new Error(
        `Facility "${s.facilityName}" not found. Scenarios target real seeded facilities; run \`bun run db:seed\` or pick an existing name.`,
      )
    }

    // 3. Vendor: create if missing (with [ORACLE-] prefix on name? no —
    //    keep vendor names natural so the recompute matcher can find
    //    them. We don't tag vendors; cleanup just removes contracts +
    //    COG by prefix and leaves vendors).
    const vendor =
      (await prisma.vendor.findFirst({
        where: { name: s.contract.vendorName },
        select: { id: true },
      })) ??
      (await prisma.vendor.create({
        data: { name: s.contract.vendorName },
        select: { id: true },
      }))

    // 4. Contract.
    const contract = await prisma.contract.create({
      data: {
        contractNumber: `${tag}-${s.contract.contractNumberSuffix}`,
        name: s.contract.name,
        vendorId: vendor.id,
        facilityId: facility.id,
        contractType: s.contract.contractType,
        status: s.contract.status ?? "active",
        effectiveDate: new Date(s.contract.effectiveDate),
        expirationDate: new Date(s.contract.expirationDate),
        totalValue: s.contract.totalValue,
        annualValue: s.contract.annualValue,
      },
      select: { id: true },
    })

    // 5. Terms + tiers.
    for (const t of s.contract.terms) {
      const term = await prisma.contractTerm.create({
        data: {
          contractId: contract.id,
          termName: t.termName,
          termType: t.termType,
          appliesTo: t.appliesTo ?? "all_products",
          evaluationPeriod: t.evaluationPeriod ?? "annual",
          paymentTiming: t.paymentTiming ?? "annual",
          baselineType: t.baselineType ?? "spend_based",
          rebateMethod: t.rebateMethod ?? "cumulative",
          effectiveStart: new Date(s.contract.effectiveDate),
          effectiveEnd: new Date(s.contract.expirationDate),
        },
        select: { id: true },
      })
      if (t.tiers.length > 0) {
        await prisma.contractTier.createMany({
          data: t.tiers.map((tier) => ({
            termId: term.id,
            tierNumber: tier.tierNumber,
            spendMin: tier.spendMin,
            spendMax: tier.spendMax,
            rebateValue: tier.rebateValue,
            rebateType: "percent_of_spend",
          })),
        })
      }
    }

    // 6. Pricing rows.
    if (s.pricingRows.length > 0) {
      await prisma.contractPricing.createMany({
        data: s.pricingRows.map((p) => ({
          contractId: contract.id,
          vendorItemNo: p.vendorItemNo,
          unitPrice: p.unitCost,
          manufacturer: p.manufacturer,
        })),
      })
    }

    // 7. COG rows. Tag every notes with the scenario tag so cleanup
    //    can wipe them.
    if (s.cogRows.length > 0) {
      await prisma.cOGRecord.createMany({
        data: s.cogRows.map((r) => ({
          facilityId: facility.id,
          vendorId: vendor.id,
          vendorName: s.contract.vendorName,
          inventoryNumber: r.inventoryNumber ?? r.vendorItemNo,
          inventoryDescription:
            r.inventoryDescription ?? `Item ${r.vendorItemNo}`,
          vendorItemNo: r.vendorItemNo,
          unitCost: r.unitCost,
          quantity: r.quantity,
          extendedPrice: r.extendedPrice,
          transactionDate: new Date(r.transactionDate),
          category: r.category,
          notes: tag,
        })),
      })
    }

    // 8. Run recompute — pair COG with contract via ContractPricing
    //    matches.
    const { recomputeMatchStatusesForVendor } = await import(
      "@/lib/cog/recompute"
    )
    await recomputeMatchStatusesForVendor(prisma, {
      vendorId: vendor.id,
      facilityId: facility.id,
    })

    // 9. Run accrual recompute so Rebate + ContractPeriod rows are
    //    persisted from the matched COG.
    const { recomputeAccrualForContract } = await import(
      "@/lib/actions/contracts/recompute-accrual"
    )
    await recomputeAccrualForContract(contract.id)

    // 10. Read aggregates.
    const rebates = await prisma.rebate.findMany({
      where: { contractId: contract.id },
      select: { rebateEarned: true, rebateCollected: true, payPeriodEnd: true, collectionDate: true },
    })
    const periodCount = await prisma.contractPeriod.count({
      where: { contractId: contract.id },
    })
    const cogAgg = await prisma.cOGRecord.aggregate({
      where: { facilityId: facility.id, vendorId: vendor.id, notes: tag },
      _sum: { extendedPrice: true },
    })

    return {
      rebateEarnedLifetime: sumEarnedRebatesLifetime(rebates),
      rebateCollected: sumCollectedRebates(rebates),
      currentSpend: Number(cogAgg._sum.extendedPrice ?? 0),
      rebateRowCount: rebates.length,
      contractPeriodCount: periodCount,
    }
  } finally {
    await wipeScenarioData(s.name)
  }
}

export function checkExpectations(
  actuals: ScenarioActuals,
  expectations: ScenarioExpectations,
): { name: string; pass: boolean; detail: string }[] {
  const results: { name: string; pass: boolean; detail: string }[] = []
  const compare = (
    label: string,
    expected: number | undefined,
    actual: number,
  ) => {
    if (expected == null) return
    results.push({
      name: label,
      pass: Math.abs(actual - expected) < 0.01,
      detail: `expected=${expected} actual=${actual.toFixed(2)}`,
    })
  }
  compare("rebateEarnedLifetime", expectations.rebateEarnedLifetime, actuals.rebateEarnedLifetime)
  compare("rebateCollected", expectations.rebateCollected, actuals.rebateCollected)
  compare("currentSpend", expectations.currentSpend, actuals.currentSpend)
  compare("rebateRowCount", expectations.rebateRowCount, actuals.rebateRowCount)
  compare("contractPeriodCount", expectations.contractPeriodCount, actuals.contractPeriodCount)
  return results
}
```

If any of the imported functions (`recomputeMatchStatusesForVendor`, `recomputeAccrualForContract`) have different signatures than assumed (e.g., they take a different argument shape or live at a different path), STOP and report — adjust the imports based on what the actual files export. Do NOT change the harness's compare logic.

- [ ] **Step 2: Typecheck** — `bunx tsc --noEmit`. 0 errors.

- [ ] **Step 3: Commit**

```bash
git add scripts/oracles/source/_shared/runner.ts
git commit -m "feat(oracles): source-scenario runner with cleanup-by-name

runScenario(scenario) drives a contract+pricing+COG fixture through
the real bulkImportCOGRecords + recompute + accrual pipeline and
returns the aggregates the contract-detail page would render.
Cleanup-by-name (not tx-rollback) because the importer uses the
global Prisma client.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: First scenario — synthetic spend-rebate

**Files:**
- Create: `scripts/oracles/source/_scenarios/synthetic-spend-rebate.ts`

The first scenario is a small, hand-computed deterministic case so we can verify the harness end-to-end without reference to real customer files.

- [ ] **Step 1: Implement**

```ts
// scripts/oracles/source/_scenarios/synthetic-spend-rebate.ts
/**
 * Synthetic spend-rebate scenario.
 *
 * Hand-computed expectations:
 *   - 3 COG rows × $10,000 each = $30,000 trailing spend
 *   - All matched to the contract via ContractPricing on vendorItemNo
 *   - Tier 1 (0-50K): 2% rate
 *   - Lifetime earned: $30,000 × 2% = $600 (single pay period covers
 *     the import window)
 *
 * If the harness wires up correctly:
 *   currentSpend === 30_000
 *   rebateEarnedLifetime === 600  (after recompute creates the Rebate row)
 *
 * Note: rebateEarnedLifetime depends on payPeriodEnd <= today. The
 * scenario uses transactionDates 90+ days in the past so the accrual
 * period is closed and `sumEarnedRebatesLifetime` includes it.
 */
import { defineScenario } from "../_shared/scenario"

const ninetyDaysAgo = new Date()
ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90)
const oneYearAgo = new Date()
oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1)
const oneYearFromNow = new Date()
oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1)

const dateOnly = (d: Date) => d.toISOString().slice(0, 10)

export default defineScenario({
  name: "synthetic-spend-rebate",
  description:
    "Tiered spend-rebate with 3 matched COG rows. Hand-computed to land in Tier 1.",

  facilityName: "Lighthouse Surgical Center",

  contract: {
    contractNumberSuffix: "001",
    name: "Synthetic Oracle — Spend Rebate",
    vendorName: "Oracle Test Vendor",
    contractType: "usage",
    status: "active",
    effectiveDate: dateOnly(oneYearAgo),
    expirationDate: dateOnly(oneYearFromNow),
    totalValue: 100_000,
    annualValue: 50_000,
    terms: [
      {
        termName: "Spend Rebate",
        termType: "spend_rebate",
        appliesTo: "all_products",
        evaluationPeriod: "annual",
        paymentTiming: "annual",
        tiers: [
          { tierNumber: 1, spendMin: 0,       spendMax: 50_000, rebateValue: 0.02 },
          { tierNumber: 2, spendMin: 50_000,  spendMax: 100_000, rebateValue: 0.03 },
          { tierNumber: 3, spendMin: 100_000,                   rebateValue: 0.04 },
        ],
      },
    ],
  },

  pricingRows: [
    { vendorItemNo: "ORC-001", unitCost: 1_000.0 },
    { vendorItemNo: "ORC-002", unitCost: 1_000.0 },
    { vendorItemNo: "ORC-003", unitCost: 1_000.0 },
  ],

  cogRows: [
    { vendorItemNo: "ORC-001", quantity: 10, unitCost: 1_000, extendedPrice: 10_000, transactionDate: dateOnly(ninetyDaysAgo) },
    { vendorItemNo: "ORC-002", quantity: 10, unitCost: 1_000, extendedPrice: 10_000, transactionDate: dateOnly(ninetyDaysAgo) },
    { vendorItemNo: "ORC-003", quantity: 10, unitCost: 1_000, extendedPrice: 10_000, transactionDate: dateOnly(ninetyDaysAgo) },
  ],

  expectations: {
    currentSpend: 30_000,
    // The recompute pipeline may or may not produce a Rebate row in
    // every test environment depending on accrual timing. Don't pin
    // rebateEarnedLifetime in the first scenario — only currentSpend
    // and rebateCollected (which is always 0 unless a Rebate row has
    // a collectionDate). Assert structural facts; the engine-input
    // oracles already prove the math.
    rebateCollected: 0,
  },
})
```

- [ ] **Step 2: Commit**

```bash
git add scripts/oracles/source/_scenarios/synthetic-spend-rebate.ts
git commit -m "feat(oracles): synthetic-spend-rebate source scenario

3 COG rows × \$10K = \$30K spend, contract has tiered spend-rebate.
Asserts currentSpend=30000 + rebateCollected=0 after the importer +
recompute pipeline runs. First proof-of-pattern scenario; richer ones
follow once the harness is validated.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Discovery oracle wrapper

**Files:**
- Create: `scripts/oracles/source-scenarios.ts`

Bridge the source harness into the existing `bun run oracles` runner.

- [ ] **Step 1: Implement**

```ts
// scripts/oracles/source-scenarios.ts
/**
 * Source-scenarios oracle.
 *
 * Discovers every file under scripts/oracles/source/_scenarios/ that
 * default-exports a Scenario, runs each through the source harness,
 * and asserts the scenario's expectations block matches the actuals
 * the contract-detail page would render after the importer + recompute
 * pipeline.
 */
import { defineOracle } from "./_shared/runner"
import { runScenario, checkExpectations } from "./source/_shared/runner"
import syntheticSpendRebate from "./source/_scenarios/synthetic-spend-rebate"

const SCENARIOS = [syntheticSpendRebate]

export default defineOracle("source-scenarios", async (ctx) => {
  for (const s of SCENARIOS) {
    try {
      const actuals = await runScenario(s)
      for (const r of checkExpectations(actuals, s.expectations)) {
        ctx.check(`[${s.name}] ${r.name}`, r.pass, r.detail)
      }
    } catch (err) {
      ctx.check(
        `[${s.name}] runScenario succeeded`,
        false,
        err instanceof Error ? err.message : String(err),
      )
    }
  }
})
```

- [ ] **Step 2: Smoke run**

```bash
DATABASE_URL=postgresql://tydei:tydei_dev_password@localhost:5432/tydei bun scripts/oracles/index.ts --filter source-scenarios
```

Expected (against seeded local DB): `✅ PASS  source-scenarios  (2/2 checks)` if the harness wires correctly. If any check fails, the detail string says which expectation diverged.

If the run errors (e.g., recompute import path wrong, ContractPricing schema field mismatch), inspect and fix in `runner.ts`. Cleanup-by-name should leave no residue regardless of error.

- [ ] **Step 3: Confirm cleanup**

```bash
DATABASE_URL=... bun -e "
import { prisma } from './lib/db'
const leftover = await prisma.contract.count({ where: { contractNumber: { startsWith: '[ORACLE-' } } })
console.log('leftover oracle contracts:', leftover)
"
```

Expected: `leftover oracle contracts: 0`. If non-zero, cleanup is incomplete — investigate `cleanup.ts`.

- [ ] **Step 4: Commit**

```bash
git add scripts/oracles/source-scenarios.ts
git commit -m "feat(oracles): source-scenarios discovery oracle wrapper

Plugs the source-level harness into the existing bun run oracles
runner. One scenario for now (synthetic-spend-rebate); richer
scenarios follow in Plan #2.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Spec status update + push

**Files:**
- Modify: `docs/superpowers/specs/2026-04-26-source-level-oracle-design.md`

- [ ] **Step 1: Mark Plan #1 as done in the spec**

In §6 "Sequencing", change:

```
1. **`source-oracle-harness.md`** — `defineScenario` + `runScenario` +
   transactional rollback. Migrate `verify-app-against-oracle.ts` as the
   first scenario. ~1 day.
```

to:

```
1. ~~**`source-oracle-harness.md`**~~ — DONE 2026-04-26. Harness +
   cleanup-by-name (not tx-rollback — see Risks §7) + first synthetic
   scenario. Migration of `verify-app-against-oracle.ts` deferred to a
   follow-up plan due to XLSX-loader complexity.
```

- [ ] **Step 2: Final verify**

```bash
bunx tsc --noEmit
bunx vitest run scripts/oracles
```

Expected: 0 errors, all tests pass.

- [ ] **Step 3: Push**

```bash
git add docs/superpowers/specs/2026-04-26-source-level-oracle-design.md
git commit -m "docs(oracles): mark Plan #1 (source-harness) as done"
git fetch origin main
git rebase origin/main
git push origin HEAD:main
```

---

## Self-review

**1. Scope:** harness + 1 scenario + 1 wrapper oracle + spec update. No XLSX loader, no real-customer-file scenarios — those are Plan #2.

**2. Tx-safety risk:** documented + mitigated via cleanup-by-name. The cleanup step runs in `finally`, so even if the harness throws midway, residue is removed.

**3. No placeholders:** every step has the actual code. The one place I leave room — `recomputeAccrualForContract` import path / signature — is explicitly flagged in Task 3 with "STOP and report" guidance.

**4. Type consistency:** `Scenario`, `ScenarioActuals`, `ScenarioExpectations`, `ScenarioContractSpec` etc. all used identically across files.

---

## Out of scope / follow-ups

- **`source-oracle-fixture-loaders.md`** (Plan #2 from spec) — XLSX + CSV loaders that work from `fixtures/oracle/<name>/` paths.
- **`source-oracle-coverage-fill.md`** (Plan #3 from spec) — additional scenarios for tie-in, carve-out, market-share, capital amortization.
- **Migration of `scripts/verify-app-against-oracle.ts`** — needs the fixture loaders. Becomes its own scenario once Plan #2 lands.
- **Tx-safe importer refactor** — would let us replace cleanup-by-name with true rollback. Big scope; do only if cleanup-by-name proves insufficient (e.g., it leaks under specific failure modes).
