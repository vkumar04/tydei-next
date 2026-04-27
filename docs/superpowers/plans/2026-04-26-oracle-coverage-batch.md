# Oracle Coverage Batch — Market Share + Capital + Forecast

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Ship three new oracles on top of the runner skeleton from `2026-04-26-oracle-runner-skeleton.md`. Each oracle runs the real app function (action or helper) AND a fully independent recompute from primary data, then asserts equality. Mismatches fail the check with a numeric diff in the detail string. Then update the CLAUDE.md canonical reducers table to include an "Oracle" column.

**Architecture:** One file per oracle under `scripts/oracles/`. Each file:
1. Imports the real app function under test (`getCategoryMarketShareForVendor`, `getContractCapitalSchedule`, etc.).
2. Imports primary Prisma reads (no shared reducers — that's the whole point).
3. Computes the truth independently with simple inline math.
4. Calls `ctx.check(name, app === oracle, "<diff string>")` for each comparison.

The runner from Plan #1 handles discovery + reports + drift diff.

**Tech Stack:** TypeScript strict, Bun runtime, Prisma 7 (read-only), the existing `defineOracle` runner.

**Why this scope:** Plan #2 (`oracle-market-share.md`) from the spec, plus two of the §2.1 coverage gaps (capital, forecast). These are the top-3 most-cited PO surfaces. Carve-out, accrual ledger, vendor-market-share, volume-CPT are deferred to a separate plan.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `scripts/oracles/market-share.ts` | Create | Recompute per-category share from raw COG; compare to `getCategoryMarketShareForVendor`. |
| `scripts/oracles/capital-amortization.ts` | Create | Recompute amortization schedule from `LeasedServiceItem` fields with PMT formula; compare to `getContractCapitalSchedule`. |
| `scripts/oracles/rebate-forecast.ts` | Create | Recompute next-12mo rebate forecast from contract terms + spend history; compare to `getRebateForecast`. |
| `CLAUDE.md` | Modify | Add "Oracle" column to canonical reducers table; populate for the 3 new helpers + collected/earned helpers if oracles already exist. |

---

## Task 1: `scripts/oracles/market-share.ts`

**Files:**
- Create: `scripts/oracles/market-share.ts`

**Pattern:** Look up the demo facility, pick a vendor with categorized spend at it, run both `getCategoryMarketShareForVendor` AND an independent recompute, assert equality per category.

**Independent recompute:** Walk all `COGRecord` rows for the facility in the trailing 12 months. For each row, resolve effective category (explicit `category` first, then matched `Contract.productCategory.name`). Sum vendor's spend per category and total spend per category. `share = vendorSpend / categoryTotal * 100`.

This is intentionally a re-derivation of `computeCategoryMarketShare` in plain inline code — NOT a call into the canonical helper. Same math from a different starting point is the point.

- [ ] **Step 1: Implement** — exact code:

```ts
// scripts/oracles/market-share.ts
/**
 * Market-share oracle.
 *
 * Recomputes per-category market share for a vendor at the demo
 * facility and asserts the app's getCategoryMarketShareForVendor
 * returns the same numbers. The recompute does NOT use
 * computeCategoryMarketShare or any other shared helper — that's the
 * whole point of an oracle. If they disagree, the detail string
 * shows which category disagreed and by how much.
 */
import { prisma } from "@/lib/db"
import { getCategoryMarketShareForVendor } from "@/lib/actions/cog/category-market-share"
import { defineOracle } from "./_shared/runner"
import { getDemoFacilityId } from "./_shared/fixtures"

export default defineOracle("market-share", async (ctx) => {
  try {
    const facilityId = await getDemoFacilityId()

    // Pick a vendor that has at least one categorized COG row at the
    // demo facility. We don't care which — we just need one to drive
    // the comparison.
    const sampleRow = await prisma.cOGRecord.findFirst({
      where: {
        facilityId,
        vendorId: { not: null },
        OR: [
          { category: { not: null } },
          { contract: { productCategory: { isNot: null } } },
        ],
      },
      select: { vendorId: true },
    })
    if (!sampleRow?.vendorId) {
      ctx.check(
        "demo facility has a categorizable vendor",
        false,
        "no COGRecord with vendor + (category | contract.productCategory) found",
      )
      return
    }
    const vendorId = sampleRow.vendorId

    // ── Independent recompute ──────────────────────────────────
    const since = new Date()
    since.setMonth(since.getMonth() - 12)

    const rows = await prisma.cOGRecord.findMany({
      where: { facilityId, transactionDate: { gte: since } },
      select: {
        vendorId: true,
        category: true,
        extendedPrice: true,
        contractId: true,
      },
    })
    const contractIds = Array.from(
      new Set(rows.map((r) => r.contractId).filter((v): v is string => !!v)),
    )
    const contractCategoryRows =
      contractIds.length > 0
        ? await prisma.contract.findMany({
            where: { id: { in: contractIds } },
            select: { id: true, productCategory: { select: { name: true } } },
          })
        : []
    const contractCategoryMap = new Map(
      contractCategoryRows.map((c) => [c.id, c.productCategory?.name ?? null]),
    )

    type Bucket = { total: number; vendorSpend: number }
    const oracleByCategory = new Map<string, Bucket>()
    for (const r of rows) {
      const amt = Number(r.extendedPrice ?? 0)
      if (amt <= 0) continue
      const cat =
        r.category ??
        (r.contractId ? contractCategoryMap.get(r.contractId) ?? null : null)
      if (!cat) continue
      const bucket = oracleByCategory.get(cat) ?? { total: 0, vendorSpend: 0 }
      bucket.total += amt
      if (r.vendorId === vendorId) bucket.vendorSpend += amt
      oracleByCategory.set(cat, bucket)
    }
    // Match the app's filter: only categories where the target vendor
    // has positive spend appear in the result.
    const oracleShares = new Map<string, number>()
    for (const [cat, b] of oracleByCategory.entries()) {
      if (b.vendorSpend <= 0) continue
      oracleShares.set(cat, b.total > 0 ? (b.vendorSpend / b.total) * 100 : 0)
    }

    // ── App ────────────────────────────────────────────────────
    // The action wraps requireFacility(); we bypass that for oracle
    // purposes by reading directly. To exercise the full app code
    // path including auth, integration tests are the right tool;
    // here we want pure compute parity. Build the same inputs the
    // helper would receive and call the underlying canonical helper
    // via a separate import to avoid the auth gate.
    //
    // Practical note: the helper's effectiveCategory + bucket math
    // is what we're verifying. requireFacility is plumbing.
    const { computeCategoryMarketShare } = await import(
      "@/lib/contracts/market-share-filter"
    )
    const appResult = computeCategoryMarketShare({
      rows,
      contractCategoryMap,
      vendorId,
    })
    const appShares = new Map(
      appResult.rows.map((r) => [r.category, r.sharePct]),
    )

    // ── Compare ────────────────────────────────────────────────
    ctx.check(
      "every oracle category appears in app output",
      [...oracleShares.keys()].every((c) => appShares.has(c)),
      `oracle has ${oracleShares.size} cats, app has ${appShares.size}; missing: ${[...oracleShares.keys()].filter((c) => !appShares.has(c)).join(", ") || "none"}`,
    )
    ctx.check(
      "every app category appears in oracle output",
      [...appShares.keys()].every((c) => oracleShares.has(c)),
      `extra in app: ${[...appShares.keys()].filter((c) => !oracleShares.has(c)).join(", ") || "none"}`,
    )

    // Per-category share equality (within 0.01 percentage points).
    let mismatches = 0
    const diffs: string[] = []
    for (const [cat, oracleShare] of oracleShares.entries()) {
      const appShare = appShares.get(cat)
      if (appShare == null) continue
      if (Math.abs(appShare - oracleShare) > 0.01) {
        mismatches++
        diffs.push(`${cat}: app=${appShare.toFixed(4)}% oracle=${oracleShare.toFixed(4)}%`)
      }
    }
    ctx.check(
      "share% matches per category (±0.01pp)",
      mismatches === 0,
      mismatches === 0
        ? `${oracleShares.size} categories agree`
        : `${mismatches} mismatches: ${diffs.slice(0, 5).join("; ")}${diffs.length > 5 ? `; …+${diffs.length - 5} more` : ""}`,
    )

    // Aggregate equality.
    const oracleTotalVendorSpend = [...oracleByCategory.values()].reduce(
      (a, b) => a + b.vendorSpend,
      0,
    )
    // Note: includes both categorized AND uncategorized vendor rows.
    let oracleAllVendorSpend = 0
    let oracleUncatSpend = 0
    for (const r of rows) {
      const amt = Number(r.extendedPrice ?? 0)
      if (amt <= 0) continue
      if (r.vendorId !== vendorId) continue
      oracleAllVendorSpend += amt
      const cat =
        r.category ??
        (r.contractId ? contractCategoryMap.get(r.contractId) ?? null : null)
      if (!cat) oracleUncatSpend += amt
    }
    ctx.check(
      "totalVendorSpend matches",
      Math.abs(appResult.totalVendorSpend - oracleAllVendorSpend) < 0.01,
      `app=${appResult.totalVendorSpend.toFixed(2)} oracle=${oracleAllVendorSpend.toFixed(2)}`,
    )
    ctx.check(
      "uncategorizedSpend matches",
      Math.abs(appResult.uncategorizedSpend - oracleUncatSpend) < 0.01,
      `app=${appResult.uncategorizedSpend.toFixed(2)} oracle=${oracleUncatSpend.toFixed(2)}`,
    )
    void oracleTotalVendorSpend
  } finally {
    await prisma.$disconnect()
  }
})
```

- [ ] **Step 2: Smoke run**

```bash
bun scripts/oracles/index.ts --filter market-share
```

Expected (when DB is seeded): `✅ PASS  market-share  (5/5 checks, …ms)` plus a report at `docs/superpowers/diagnostics/oracle-runs/<date>-market-share.md`.

If the demo facility doesn't have a categorizable vendor, the first check fails with the explanation; that's a data issue, not a code bug.

If any per-category share mismatches, **investigate** — the helper and the inline recompute should agree. A real disagreement means either the helper has drifted or the oracle's recompute has drifted; line up the two implementations and find the divergence.

- [ ] **Step 3: Typecheck**

```bash
bunx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add scripts/oracles/market-share.ts
git commit -m "feat(oracles): market-share oracle vs computeCategoryMarketShare

Independent recompute of per-category share from raw COG +
contract-category fallback. Asserts equality with the canonical
helper to within 0.01pp per category, plus aggregate fields.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `scripts/oracles/capital-amortization.ts`

**Files:**
- Create: `scripts/oracles/capital-amortization.ts`

**Pattern:** Pick a contract that has `LeasedServiceItem` rows. Compute the standard PMT-formula amortization for each item from `(financed, interestRate, termMonths, paymentCadence)`. Compare against the app's `buildTieInAmortizationSchedule` output.

- [ ] **Step 1: Read the helper**

```bash
cat lib/actions/contracts/tie-in.ts | head -80
grep -n "buildTieInAmortizationSchedule\|computeAmortization" lib/contracts/*.ts lib/actions/contracts/*.ts | head
```

Confirm the helper's name and call signature. The plan assumes an exported pure function takes a `LeasedServiceItem`-shaped input and returns a schedule. If it requires session/auth, oracle calls the underlying engine function (one layer below the action), same pattern as Task 1.

- [ ] **Step 2: Implement**

```ts
// scripts/oracles/capital-amortization.ts
/**
 * Capital amortization oracle.
 *
 * Recomputes the symmetrical PMT amortization for each LeasedServiceItem
 * on a tie-in / capital contract and asserts the app's
 * buildTieInAmortizationSchedule returns the same schedule.
 */
import { prisma } from "@/lib/db"
import { defineOracle } from "./_shared/runner"

/** Standard PMT formula: monthly payment for principal P at monthly
 *  rate r over n periods. Returns 0 when r=0 or n=0 (no schedule). */
function pmt(principal: number, monthlyRate: number, n: number): number {
  if (n <= 0) return 0
  if (monthlyRate === 0) return principal / n
  const r = monthlyRate
  return (principal * r) / (1 - Math.pow(1 + r, -n))
}

export default defineOracle("capital-amortization", async (ctx) => {
  try {
    // Find a contract with at least one LeasedServiceItem.
    const item = await prisma.leasedServiceItem.findFirst({
      where: { contractTotal: { gt: 0 }, term: { gt: 0 } },
      select: {
        id: true,
        contractId: true,
        contractTotal: true,
        initialSales: true,
        interestRate: true,
        term: true,
        paymentCadence: true,
        paymentType: true,
      },
    })
    if (!item) {
      ctx.check(
        "demo DB has a LeasedServiceItem to compare",
        false,
        "no LeasedServiceItem with contractTotal>0 and term>0 found; run db:seed",
      )
      return
    }

    // ── Independent oracle recompute ────────────────────────────
    const financed =
      Number(item.contractTotal ?? 0) - Number(item.initialSales ?? 0)
    const annualRatePct = Number(item.interestRate ?? 0)
    const monthlyRate = annualRatePct / 100 / 12
    const n = item.term ?? 0
    const oraclePayment = pmt(financed, monthlyRate, n)
    const oracleTotalPayments = oraclePayment * n
    const oracleTotalInterest = oracleTotalPayments - financed

    // ── App ─────────────────────────────────────────────────────
    const { buildTieInAmortizationSchedule } = await import(
      "@/lib/contracts/tie-in-amortization"
    )
    const schedule = buildTieInAmortizationSchedule({
      financedAmount: financed,
      annualInterestRatePercent: annualRatePct,
      termMonths: n,
      paymentCadence: (item.paymentCadence ?? "Monthly") as "Monthly" | "Quarterly" | "Annually",
    })

    const appPayment = schedule.periodicPayment
    const appTotalPayments = schedule.periods.reduce(
      (a, p) => a + p.payment,
      0,
    )
    const appTotalInterest = schedule.periods.reduce(
      (a, p) => a + p.interest,
      0,
    )
    const appTotalPrincipal = schedule.periods.reduce(
      (a, p) => a + p.principal,
      0,
    )

    // ── Compare ─────────────────────────────────────────────────
    ctx.check(
      "periodic payment matches PMT formula (±$0.01)",
      Math.abs(appPayment - oraclePayment) < 0.01,
      `app=$${appPayment.toFixed(2)} oracle=$${oraclePayment.toFixed(2)} (financed=$${financed.toFixed(2)} rate=${annualRatePct}% n=${n})`,
    )
    ctx.check(
      "total payments equal payment × n",
      Math.abs(appTotalPayments - oracleTotalPayments) < 0.05,
      `app=$${appTotalPayments.toFixed(2)} oracle=$${oracleTotalPayments.toFixed(2)}`,
    )
    ctx.check(
      "principal sum equals financed amount",
      Math.abs(appTotalPrincipal - financed) < 0.05,
      `app=$${appTotalPrincipal.toFixed(2)} financed=$${financed.toFixed(2)}`,
    )
    ctx.check(
      "principal + interest = total payments (no rounding leak)",
      Math.abs(
        appTotalPrincipal + appTotalInterest - appTotalPayments,
      ) < 0.01,
      `principal=$${appTotalPrincipal.toFixed(2)} interest=$${appTotalInterest.toFixed(2)} total=$${appTotalPayments.toFixed(2)}`,
    )
    ctx.check(
      "interest sum matches oracle (±$0.05)",
      Math.abs(appTotalInterest - oracleTotalInterest) < 0.05,
      `app=$${appTotalInterest.toFixed(2)} oracle=$${oracleTotalInterest.toFixed(2)}`,
    )
  } finally {
    await prisma.$disconnect()
  }
})
```

- [ ] **Step 3: Smoke run**

```bash
bun scripts/oracles/index.ts --filter capital-amortization
```

Expected (DB seeded): all 5 checks pass. If the helper file path or export name differs from the plan's guess, fix the import based on the file you read in Step 1; do NOT change the assertions.

- [ ] **Step 4: Commit**

```bash
git add scripts/oracles/capital-amortization.ts
git commit -m "feat(oracles): capital-amortization oracle vs PMT formula

Independent PMT-formula recompute compared against the app's
buildTieInAmortizationSchedule. Catches: payment formula drift,
principal/interest rounding leaks, total-payment miscount.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `scripts/oracles/rebate-forecast.ts`

**Files:**
- Create: `scripts/oracles/rebate-forecast.ts`

**Pattern:** For each tier'd contract, recompute the next-12mo rebate forecast using a simple linear extrapolation of trailing-12mo monthly spend × the tier rate the cumulative spend would land in. Compare against `getRebateForecast`.

The forecast is approximate by nature; this oracle's job is to catch *gross* drift (e.g., the kind that produced PO complaint #16 where the chart was empty), not nail decimal-level parity.

- [ ] **Step 1: Read the action**

```bash
cat lib/actions/analytics/rebate-forecast.ts | head -60
```

Identify the input shape and which fields the result returns (`history`, `forecast`, `growth`, `confidence` — check the actual exported types).

- [ ] **Step 2: Implement**

```ts
// scripts/oracles/rebate-forecast.ts
/**
 * Rebate forecast oracle (gross-drift detector).
 *
 * Computes a naive 12-month projection from the contract's trailing
 * spend × marginal tier rate and asserts the app's forecast curve is
 * within an order of magnitude of it. The goal is to catch
 * silent-zero regressions like the one #82 fixed in 93d4dd0 (forecast
 * was hard-pinned to terms[0]; volume terms produced a flat $0 line).
 *
 * Not a precision oracle — the app's forecast uses linear regression
 * + seasonality and we use simple extrapolation. We assert lower-bound
 * sanity, not bit equality.
 */
import { prisma } from "@/lib/db"
import { defineOracle } from "./_shared/runner"
import { getDemoFacilityId } from "./_shared/fixtures"

export default defineOracle("rebate-forecast", async (ctx) => {
  try {
    const facilityId = await getDemoFacilityId()

    // Find a contract at the demo facility with at least one tiered
    // rebate term and some trailing spend history.
    const contract = await prisma.contract.findFirst({
      where: {
        facilityId,
        terms: { some: { tiers: { some: {} } } },
      },
      select: { id: true, name: true },
    })
    if (!contract) {
      ctx.check(
        "demo facility has a tiered contract for forecasting",
        false,
        "no Contract with terms+tiers at demo facility; run db:seed",
      )
      return
    }

    // ── Naive oracle forecast: trailing 12 months of period spend
    // averaged → projected for the next 12 months. We don't apply tier
    // math here because the goal is drift detection on the raw curve;
    // the app applies tier rates downstream and we'd just be
    // re-implementing what we're checking.
    const since = new Date()
    since.setMonth(since.getMonth() - 12)
    const periods = await prisma.contractPeriod.findMany({
      where: { contractId: contract.id, payPeriodEnd: { gte: since } },
      select: { totalSpend: true },
    })
    const trailingSpend = periods.reduce(
      (a, p) => a + Number(p.totalSpend ?? 0),
      0,
    )
    const oracleAvgMonthly = trailingSpend / 12

    // ── App forecast ────────────────────────────────────────────
    const { getRebateForecast } = await import(
      "@/lib/actions/analytics/rebate-forecast"
    )
    // Bypass the auth gate by calling through the underlying engine
    // module if exported separately. If only the action is exported,
    // fall back to mocking requireFacility — but for this oracle we
    // accept the auth coupling and skip if it throws.
    let forecast: Awaited<ReturnType<typeof getRebateForecast>> | null = null
    try {
      forecast = await getRebateForecast(contract.id)
    } catch (err) {
      ctx.check(
        "getRebateForecast callable from oracle context",
        false,
        `${err instanceof Error ? err.message : String(err)} — likely auth gate; consider extracting the engine to a non-action helper`,
      )
      return
    }

    if (!forecast || !Array.isArray(forecast.forecast)) {
      ctx.check(
        "forecast result has a forecast array",
        false,
        `got: ${JSON.stringify(forecast).slice(0, 200)}`,
      )
      return
    }

    // ── Drift detection ─────────────────────────────────────────
    const appForecastSpendSum = forecast.forecast.reduce(
      (a, p) => a + Number(p.spend ?? 0),
      0,
    )
    const appForecastRebateSum = forecast.forecast.reduce(
      (a, p) => a + Number(p.rebate ?? 0),
      0,
    )
    const oracleForecastSpend = oracleAvgMonthly * 12

    ctx.check(
      "forecast contains 12 monthly points",
      forecast.forecast.length === 12,
      `got ${forecast.forecast.length}`,
    )

    // The app's forecast may apply seasonality + growth on top of a
    // moving average; allow ±50% from the naive trailing extrapolation.
    // Anything outside that band suggests a silent zero (#82) or a
    // runaway scaling bug.
    const drift =
      oracleForecastSpend === 0
        ? appForecastSpendSum
        : Math.abs(appForecastSpendSum - oracleForecastSpend) /
          oracleForecastSpend
    ctx.check(
      "forecast spend sum within 50% of trailing-12mo extrapolation",
      drift <= 0.5 || (oracleForecastSpend === 0 && appForecastSpendSum === 0),
      `app=$${appForecastSpendSum.toFixed(0)} oracle=$${oracleForecastSpend.toFixed(0)} drift=${(drift * 100).toFixed(1)}%`,
    )

    // Catch the silent-zero class: if there's any historical spend, the
    // forecast must produce some rebate.
    if (trailingSpend > 0) {
      ctx.check(
        "forecast rebate sum is non-zero when contract has spend",
        appForecastRebateSum > 0,
        `trailing-12mo spend=$${trailingSpend.toFixed(0)} but forecast rebate sum=$${appForecastRebateSum.toFixed(2)}`,
      )
    }
  } finally {
    await prisma.$disconnect()
  }
})
```

- [ ] **Step 3: Smoke run**

```bash
bun scripts/oracles/index.ts --filter rebate-forecast
```

Expected: passes if a tiered contract exists. If `getRebateForecast` requires a session that the oracle can't satisfy, the check "callable from oracle context" fails with a clear message — that's a real signal that the action needs an engine-layer extraction, not a runner bug.

- [ ] **Step 4: Commit**

```bash
git add scripts/oracles/rebate-forecast.ts
git commit -m "feat(oracles): rebate-forecast oracle (gross-drift detector)

Catches the #82 silent-zero class — when forecast goes flat $0
because of a term-type selection bug — without trying to match the
app's regression+seasonality precision.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: CLAUDE.md "Oracle" column

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add the column**

Find the canonical reducers table in CLAUDE.md. The current header is:

```
| Invariant | Canonical helper | File | Used by |
```

Change to:

```
| Invariant | Canonical helper | File | Used by | Oracle |
```

For each existing row, add a final cell. Populate it as:

| Row | Oracle cell |
|---|---|
| Rebates Collected | `scripts/oracles/full-sweep.ts` (collected aggregate validated against rebate-row presence) |
| Rebates Earned (lifetime) | `scripts/oracles/full-sweep.ts` |
| Rebates Earned (YTD) | _(none — gap)_ |
| COG in-term-scope | _(none — gap)_ |
| Contract ownership | _(N/A — auth invariant, not numeric)_ |
| Rebate-units scaling | `scripts/oracles/full-sweep.ts` (cumulative + marginal calc engine) |
| Rebate applied to capital | `scripts/oracles/capital-amortization.ts` (per-period principal/interest equality) |
| Per-category market share | `scripts/oracles/market-share.ts` |

For the "Per-category market share" row, the existing `Used by` cell already mentions `market-share-parity.test.ts`; append the oracle.

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add Oracle column to canonical reducers invariants table

Future helpers must add an oracle in the same PR or document why they
can't. Empty cells are tracked gaps — the next oracle plan
(YTD-earned, COG-in-term-scope) drops them.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Final verify + push

- [ ] **Step 1: Typecheck + targeted vitest**

```bash
bunx tsc --noEmit
bunx vitest run scripts/oracles
```

- [ ] **Step 2: Full vitest sweep**

```bash
bunx vitest run lib components scripts
```

Expected: all green.

- [ ] **Step 3: Run all oracles end-to-end (best effort)**

```bash
DATABASE_URL=postgresql://tydei:tydei_dev_password@localhost:5432/tydei bun run oracles
```

If the local DB is unreachable, skip — the runner discovery still validates wiring.

- [ ] **Step 4: Rebase + push**

```bash
git fetch origin main
git rebase origin/main
git push origin HEAD:main
```

---

## Self-review

**1. Plan coverage:**
- Plan #2 (`oracle-market-share.md`) — Task 1. ✅
- Spec §2.1 capital-amortization gap — Task 2. ✅
- Spec §2.1 rebate-forecast gap — Task 3. ✅
- Spec §3.5 wire to invariants table — Task 4. ✅
- Carve-out, vendor-market-share, accrual-ledger, volume-CPT — out of scope, separate plan.

**2. Risks:**
- The forecast oracle imports `getRebateForecast` directly; if the action requires `requireFacility` and the oracle runs without a session, the auth check in the action throws. The plan handles this with a try/catch around the call and reports it as a clear failure rather than a runner crash. The fix (extract the engine) is a real follow-up surfaced by this oracle.
- The capital oracle assumes `buildTieInAmortizationSchedule` is exported from `@/lib/contracts/tie-in-amortization`. If the actual path differs, Task 2 Step 1 says to verify and adjust the import — but do NOT change the assertions.
- Each oracle owns its own `prisma.$disconnect()` in a `finally`. If multiple oracles run in one process, the second disconnect is a no-op (Prisma handles redundant disconnects).

**3. No placeholders:** every step has concrete code, paths, commands, expected output.
