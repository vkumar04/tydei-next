# Source Oracle Coverage Fill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** Add four new source-level scenarios beyond `synthetic-spend-rebate`: tie-in capital, carve-out, market-share commitment, and growth-rebate. Each exercises a distinct contract type / term shape end-to-end through the importer + recompute pipeline. After this plan, every contract type in the spec has at least one source-level oracle scenario.

**Architecture:** One scenario file per case under `scripts/oracles/source/_scenarios/`. Each follows the `synthetic-spend-rebate.ts` pattern: hand-computed expectations, inline pricing+COG rows, a single `defineScenario` default export. The `source-scenarios.ts` discovery oracle imports them all and runs each through `runScenario`.

**Tech Stack:** TypeScript strict, Bun runtime. Reuses the harness from Plan #1 — no new infrastructure.

**Why this scope:** Plan #3 from `2026-04-26-source-level-oracle-design.md`. The harness exists; the synthetic-spend-rebate scenario proves the pattern. Each new scenario is ~80 lines. Adding them in one batch unblocks confidence on tie-in / carve-out / market-share / growth — currently zero source-level coverage.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `scripts/oracles/source/_scenarios/synthetic-tie-in-capital.ts` | Create | Tie-in contract with capital line items + rebate split toward capital. |
| `scripts/oracles/source/_scenarios/synthetic-carve-out.ts` | Create | Per-line `carveOutPercent` on pricing rows; spend-based carve-out term. |
| `scripts/oracles/source/_scenarios/synthetic-market-share-commitment.ts` | Create | Contract with `marketShareCommitmentByCategory` JSON; verify reads in expectations. |
| `scripts/oracles/source/_scenarios/synthetic-growth-rebate.ts` | Create | Growth-rebate term with prior-period baseline + forward-looking spend. |
| `scripts/oracles/source-scenarios.ts` | Modify | Import + register the four new scenarios. |

---

## Task 1: synthetic-tie-in-capital scenario

**Files:**
- Create: `scripts/oracles/source/_scenarios/synthetic-tie-in-capital.ts`

The tie-in contract type joins implant usage to capital equipment. The minimum here: a `tie_in` contract + at least one `ContractCapitalLineItem` row + COG rows that should match. Expectations: `currentSpend` reflects the COG sum.

- [ ] **Step 1: Implement**

```ts
// scripts/oracles/source/_scenarios/synthetic-tie-in-capital.ts
/**
 * Synthetic tie-in capital scenario.
 *
 * tie_in contract type. The harness's runScenario currently handles
 * contracts + terms + tiers + pricing + COG, but does NOT seed
 * ContractCapitalLineItem rows from the scenario yet — that's in the
 * follow-up plan. For this scenario we exercise the contractType
 * path through the importer + recompute and assert the standard
 * aggregates land correctly. Capital-line-item-specific assertions
 * come once the harness supports seeding them.
 *
 * Hand-computed: 2 COG rows × $20K each = $40K spend.
 */
import { defineScenario } from "../_shared/scenario"

const ninetyDaysAgo = new Date()
ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90)
const oneYearAgo = new Date()
oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1)
const twoYearsFromNow = new Date()
twoYearsFromNow.setFullYear(twoYearsFromNow.getFullYear() + 2)

const dateOnly = (d: Date) => d.toISOString().slice(0, 10)

export default defineScenario({
  name: "synthetic-tie-in-capital",
  description: "tie-in contract type + tiered usage commitment + 2 matched COG rows ($40K).",

  facilityName: "Lighthouse Surgical Center",

  contract: {
    contractNumberSuffix: "001",
    name: "Synthetic Oracle — Tie-In Capital",
    vendorName: "Oracle Tie-In Vendor",
    contractType: "tie_in",
    status: "active",
    effectiveDate: dateOnly(oneYearAgo),
    expirationDate: dateOnly(twoYearsFromNow),
    totalValue: 500_000,
    annualValue: 166_667,
    terms: [
      {
        termName: "Joint Implant Commitment",
        termType: "spend_rebate",
        appliesTo: "all_products",
        evaluationPeriod: "annual",
        paymentTiming: "annual",
        tiers: [
          { tierNumber: 1, spendMin: 0,        spendMax: 100_000, rebateValue: 0.025 },
          { tierNumber: 2, spendMin: 100_000,                     rebateValue: 0.04 },
        ],
      },
    ],
  },

  pricingRows: [
    { vendorItemNo: "TIE-001", unitCost: 10_000.0 },
    { vendorItemNo: "TIE-002", unitCost: 10_000.0 },
  ],

  cogRows: [
    { vendorItemNo: "TIE-001", quantity: 2, unitCost: 10_000, extendedPrice: 20_000, transactionDate: dateOnly(ninetyDaysAgo) },
    { vendorItemNo: "TIE-002", quantity: 2, unitCost: 10_000, extendedPrice: 20_000, transactionDate: dateOnly(ninetyDaysAgo) },
  ],

  expectations: {
    currentSpend: 40_000,
    rebateCollected: 0,
  },
})
```

- [ ] **Step 2: Smoke** — `DATABASE_URL=postgresql://tydei:tydei_dev_password@localhost:5432/tydei bun scripts/oracles/index.ts --filter source-scenarios`. Should still PASS the synthetic-spend-rebate scenario; the new tie-in scenario is wired in Task 5.

---

## Task 2: synthetic-carve-out scenario

**Files:**
- Create: `scripts/oracles/source/_scenarios/synthetic-carve-out.ts`

- [ ] **Step 1: Implement**

```ts
// scripts/oracles/source/_scenarios/synthetic-carve-out.ts
/**
 * Synthetic carve-out scenario.
 *
 * carve_out term where rebate is computed per-line as
 * `unitCost × quantity × carveOutPercent`. The harness's pricingRows
 * type doesn't yet carry carveOutPercent; this scenario exercises
 * the importer path with regular pricing and a contract-level carve_out
 * term (per-line carveOutPercent rows are a follow-up — track in the
 * out-of-scope section).
 *
 * Hand-computed: 4 COG rows × $5K = $20K spend.
 */
import { defineScenario } from "../_shared/scenario"

const sixtyDaysAgo = new Date()
sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60)
const oneYearAgo = new Date()
oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1)
const oneYearFromNow = new Date()
oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1)
const dateOnly = (d: Date) => d.toISOString().slice(0, 10)

export default defineScenario({
  name: "synthetic-carve-out",
  description: "carve_out term + 4 matched COG rows ($20K).",

  facilityName: "Lighthouse Surgical Center",

  contract: {
    contractNumberSuffix: "001",
    name: "Synthetic Oracle — Carve-Out",
    vendorName: "Oracle Carve-Out Vendor",
    contractType: "usage",
    status: "active",
    effectiveDate: dateOnly(oneYearAgo),
    expirationDate: dateOnly(oneYearFromNow),
    totalValue: 60_000,
    annualValue: 30_000,
    terms: [
      {
        termName: "Carve-Out",
        termType: "carve_out",
        appliesTo: "all_products",
        evaluationPeriod: "quarterly",
        paymentTiming: "quarterly",
        tiers: [{ tierNumber: 1, spendMin: 0, rebateValue: 0.05 }],
      },
    ],
  },

  pricingRows: [
    { vendorItemNo: "CO-001", unitCost: 1_250.0 },
    { vendorItemNo: "CO-002", unitCost: 1_250.0 },
    { vendorItemNo: "CO-003", unitCost: 1_250.0 },
    { vendorItemNo: "CO-004", unitCost: 1_250.0 },
  ],

  cogRows: [
    { vendorItemNo: "CO-001", quantity: 4, unitCost: 1_250, extendedPrice: 5_000, transactionDate: dateOnly(sixtyDaysAgo) },
    { vendorItemNo: "CO-002", quantity: 4, unitCost: 1_250, extendedPrice: 5_000, transactionDate: dateOnly(sixtyDaysAgo) },
    { vendorItemNo: "CO-003", quantity: 4, unitCost: 1_250, extendedPrice: 5_000, transactionDate: dateOnly(sixtyDaysAgo) },
    { vendorItemNo: "CO-004", quantity: 4, unitCost: 1_250, extendedPrice: 5_000, transactionDate: dateOnly(sixtyDaysAgo) },
  ],

  expectations: {
    currentSpend: 20_000,
    rebateCollected: 0,
  },
})
```

---

## Task 3: synthetic-market-share-commitment scenario

**Files:**
- Create: `scripts/oracles/source/_scenarios/synthetic-market-share-commitment.ts`

- [ ] **Step 1: Implement**

```ts
// scripts/oracles/source/_scenarios/synthetic-market-share-commitment.ts
/**
 * Synthetic market-share-commitment scenario.
 *
 * market_share term type. The contract carries category-level
 * commitments (vendor commits to N% of facility spend in each
 * category). The harness doesn't seed
 * marketShareCommitmentByCategory yet — that's a follow-up — so this
 * scenario is currently structural: confirms a market_share term
 * imports cleanly and the standard aggregates land. Per-category
 * commitment expectations come with the follow-up.
 *
 * Hand-computed: 3 COG rows × $8K each = $24K spend.
 */
import { defineScenario } from "../_shared/scenario"

const fortyFiveDaysAgo = new Date()
fortyFiveDaysAgo.setDate(fortyFiveDaysAgo.getDate() - 45)
const oneYearAgo = new Date()
oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1)
const oneYearFromNow = new Date()
oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1)
const dateOnly = (d: Date) => d.toISOString().slice(0, 10)

export default defineScenario({
  name: "synthetic-market-share-commitment",
  description: "market_share term + 3 matched COG rows in Spine category ($24K).",

  facilityName: "Lighthouse Surgical Center",

  contract: {
    contractNumberSuffix: "001",
    name: "Synthetic Oracle — Market Share Commitment",
    vendorName: "Oracle Market-Share Vendor",
    contractType: "usage",
    status: "active",
    effectiveDate: dateOnly(oneYearAgo),
    expirationDate: dateOnly(oneYearFromNow),
    totalValue: 80_000,
    annualValue: 40_000,
    terms: [
      {
        termName: "Spine Market Share",
        termType: "market_share_rebate",
        appliesTo: "specific_category",
        evaluationPeriod: "annual",
        paymentTiming: "annual",
        tiers: [
          { tierNumber: 1, spendMin: 0,    rebateValue: 0.02 },
          { tierNumber: 2, spendMin: 50,   rebateValue: 0.03 },
          { tierNumber: 3, spendMin: 75,   rebateValue: 0.04 },
        ],
      },
    ],
  },

  pricingRows: [
    { vendorItemNo: "MS-001", unitCost: 8_000.0, category: "Spine" },
    { vendorItemNo: "MS-002", unitCost: 8_000.0, category: "Spine" },
    { vendorItemNo: "MS-003", unitCost: 8_000.0, category: "Spine" },
  ],

  cogRows: [
    { vendorItemNo: "MS-001", quantity: 1, unitCost: 8_000, extendedPrice: 8_000, transactionDate: dateOnly(fortyFiveDaysAgo), category: "Spine" },
    { vendorItemNo: "MS-002", quantity: 1, unitCost: 8_000, extendedPrice: 8_000, transactionDate: dateOnly(fortyFiveDaysAgo), category: "Spine" },
    { vendorItemNo: "MS-003", quantity: 1, unitCost: 8_000, extendedPrice: 8_000, transactionDate: dateOnly(fortyFiveDaysAgo), category: "Spine" },
  ],

  expectations: {
    currentSpend: 24_000,
    rebateCollected: 0,
  },
})
```

---

## Task 4: synthetic-growth-rebate scenario

**Files:**
- Create: `scripts/oracles/source/_scenarios/synthetic-growth-rebate.ts`

- [ ] **Step 1: Implement**

```ts
// scripts/oracles/source/_scenarios/synthetic-growth-rebate.ts
/**
 * Synthetic growth-rebate scenario.
 *
 * growth_rebate term type. Tier thresholds are growth-pct values
 * vs prior-period baseline. The harness imports this through the
 * standard pipeline; growth-specific math depends on baseline data
 * the recompute engine pulls from prior periods (which we don't
 * synthesize here), so expectations are limited to structural
 * aggregates.
 *
 * Hand-computed: 5 COG rows × $4K = $20K spend.
 */
import { defineScenario } from "../_shared/scenario"

const thirtyDaysAgo = new Date()
thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
const eighteenMonthsAgo = new Date()
eighteenMonthsAgo.setMonth(eighteenMonthsAgo.getMonth() - 18)
const sixMonthsFromNow = new Date()
sixMonthsFromNow.setMonth(sixMonthsFromNow.getMonth() + 6)
const dateOnly = (d: Date) => d.toISOString().slice(0, 10)

export default defineScenario({
  name: "synthetic-growth-rebate",
  description: "growth_rebate term + 5 matched COG rows ($20K).",

  facilityName: "Lighthouse Surgical Center",

  contract: {
    contractNumberSuffix: "001",
    name: "Synthetic Oracle — Growth Rebate",
    vendorName: "Oracle Growth Vendor",
    contractType: "usage",
    status: "active",
    effectiveDate: dateOnly(eighteenMonthsAgo),
    expirationDate: dateOnly(sixMonthsFromNow),
    totalValue: 100_000,
    annualValue: 50_000,
    terms: [
      {
        termName: "YoY Growth",
        termType: "growth_rebate",
        appliesTo: "all_products",
        evaluationPeriod: "annual",
        paymentTiming: "annual",
        tiers: [
          { tierNumber: 1, spendMin: 0,    rebateValue: 0.01 },
          { tierNumber: 2, spendMin: 5,    rebateValue: 0.02 },
          { tierNumber: 3, spendMin: 10,   rebateValue: 0.03 },
        ],
      },
    ],
  },

  pricingRows: [
    { vendorItemNo: "GR-001", unitCost: 800.0 },
    { vendorItemNo: "GR-002", unitCost: 800.0 },
    { vendorItemNo: "GR-003", unitCost: 800.0 },
    { vendorItemNo: "GR-004", unitCost: 800.0 },
    { vendorItemNo: "GR-005", unitCost: 800.0 },
  ],

  cogRows: [
    { vendorItemNo: "GR-001", quantity: 5, unitCost: 800, extendedPrice: 4_000, transactionDate: dateOnly(thirtyDaysAgo) },
    { vendorItemNo: "GR-002", quantity: 5, unitCost: 800, extendedPrice: 4_000, transactionDate: dateOnly(thirtyDaysAgo) },
    { vendorItemNo: "GR-003", quantity: 5, unitCost: 800, extendedPrice: 4_000, transactionDate: dateOnly(thirtyDaysAgo) },
    { vendorItemNo: "GR-004", quantity: 5, unitCost: 800, extendedPrice: 4_000, transactionDate: dateOnly(thirtyDaysAgo) },
    { vendorItemNo: "GR-005", quantity: 5, unitCost: 800, extendedPrice: 4_000, transactionDate: dateOnly(thirtyDaysAgo) },
  ],

  expectations: {
    currentSpend: 20_000,
    rebateCollected: 0,
  },
})
```

---

## Task 5: Register all four scenarios

**Files:**
- Modify: `scripts/oracles/source-scenarios.ts`

- [ ] **Step 1: Update the registry**

Replace the SCENARIOS array:

```ts
import syntheticSpendRebate from "./source/_scenarios/synthetic-spend-rebate"
import syntheticTieInCapital from "./source/_scenarios/synthetic-tie-in-capital"
import syntheticCarveOut from "./source/_scenarios/synthetic-carve-out"
import syntheticMarketShare from "./source/_scenarios/synthetic-market-share-commitment"
import syntheticGrowthRebate from "./source/_scenarios/synthetic-growth-rebate"

const SCENARIOS = [
  syntheticSpendRebate,
  syntheticTieInCapital,
  syntheticCarveOut,
  syntheticMarketShare,
  syntheticGrowthRebate,
]
```

- [ ] **Step 2: Smoke run**

```bash
DATABASE_URL=postgresql://tydei:tydei_dev_password@localhost:5432/tydei bun scripts/oracles/index.ts --filter source-scenarios
```

Expected: `✅ PASS  source-scenarios  (10/10 checks)` — 2 checks per scenario × 5 scenarios. If any individual scenario fails, the detail shows which expectation diverged.

If a `termType` value isn't accepted by the schema (e.g. `market_share_rebate` is wrong; the actual enum value might be different), the runScenario errors out. Check Prisma schema for valid `ContractTerm.termType` enum values and adjust the failing scenario's `termType` accordingly. Same for `contractType`.

- [ ] **Step 3: Confirm cleanup**

```bash
DATABASE_URL=... bun -e "
import { prisma } from './lib/db'
const c = await prisma.contract.count({ where: { contractNumber: { startsWith: '[ORACLE-' } } })
console.log('leftover oracle contracts:', c)
"
```

Expect 0.

- [ ] **Step 4: Commit + push**

```bash
git add scripts/oracles/source/_scenarios/ scripts/oracles/source-scenarios.ts
git commit -m "feat(oracles): four new source-level scenarios

tie-in-capital, carve-out, market-share-commitment, growth-rebate.
Each exercises a distinct contract type / term shape end-to-end
through the importer + recompute pipeline. Structural assertions
(currentSpend, rebateCollected) — type-specific math assertions
are follow-ups that need the harness to seed
ContractCapitalLineItem / ContractPricing.carveOutPercent /
Contract.marketShareCommitmentByCategory.

Spec 2026-04-26-source-level-oracle-design.md Plan #3.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"

git fetch origin main
git rebase origin/main
git push origin HEAD:main
```

---

## Self-review

**1. Coverage:** every contract type / common term type now has at least one source-level scenario.

**2. No placeholders:** every step has the actual code.

**3. Risk:** `termType` and `contractType` enum values used in the scenarios may not all match the Prisma schema. Task 5 Step 2 says "STOP and adjust" if any scenario errors at the term-create step. The likely-wrong ones to check: `market_share_rebate` (could be `market_share` or `market_share_rebate` depending on enum naming), `growth_rebate` (likely correct).

---

## Out of scope / follow-ups

- **Per-line carveOutPercent** on pricing rows — needs `ScenarioPricingRow.carveOutPercent` field + harness threading it into ContractPricing. Then carve-out scenario can have non-zero rebateEarned expectation.
- **ContractCapitalLineItem seeding** in the harness. Then tie-in scenario can assert capital schedule correctness end-to-end (engine-input oracle already covers the math).
- **`marketShareCommitmentByCategory` JSON** seeded by harness from scenario.contract — then market-share scenario can assert per-category share against a populated commitment.
- **Real-customer-file scenarios** (Charles's Arthrex bundle) — needs Plan #2's CSV/XLSX loaders.
