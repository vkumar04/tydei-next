# Rebate Term Types Extension — Design Spec

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement the subsystems below. Each subsystem gets its own per-subsystem TDD plan generated on demand. Steps in those plans use checkbox (`- [ ]`) syntax for tracking.

**Date:** 2026-04-18
**Branch:** continue in `contracts-rewrite-00-schema`
**Status:** Design approved by Vick (2026-04-18). Scoped addition to contracts-rewrite to cover `carve_out` and `po_rebate` explicitly, with a documented roadmap for the remaining 10 `TermType` variants.
**Related specs:**
- Shipped: `2026-04-18-contracts-rewrite.md` (subsystem 1 shipped cumulative vs marginal for `spend_rebate`; this spec extends engine coverage across the full `TermType` enum)
- Required dependency: `2026-04-18-platform-data-model-reconciliation.md` (canonical matcher + scope resolution)
- Referenced by: `contracts-list-closure` (compare cards) + future vendor-operations spec + `data-pipeline-rewrite` (invoice validation uses carve-out to exclude specific items from compliance checks)

**Goal:** Close the rebate engine's coverage gap so every `TermType` the schema already supports computes correctly. V1 ships `carve_out` and `po_rebate` end-to-end; v2 roadmap is documented for the remaining term types so they can land in follow-up specs without re-architecting.

**Architecture:** Additive extensions on top of contracts-rewrite's existing engines. A new dispatcher `calculateRebateByTermType(term, context)` routes to the right sub-engine based on `term.termType`. Each sub-engine is pure and tested. The tier-math helpers from subsystem 1 get reused where applicable.

**Tech Stack (unchanged):** Next.js 16, Prisma 7, Vitest, TypeScript strict mode. No new dependencies.

---

## 1. Scope

### In scope (v1)

**Two term types get full end-to-end coverage:**

1. **`carve_out`** — specified items (by `vendorItemNo`) or categories are **excluded** from the main rebate calculation. Rationale: the vendor negotiated different terms on specific SKUs that are being "carved out" of the headline deal.

2. **`po_rebate`** — rebate tied to **per-PO thresholds** rather than cumulative contract spend. Rationale: vendors sometimes offer "$5,000 PO gets 3% back, $10,000 PO gets 5% back" type arrangements that don't aggregate across the contract lifetime.

**Engine + schema + UI + tests:**
- Calculation engine per type (pure functions)
- Dispatcher in the existing rebate facade (`lib/rebates/calculate.ts`)
- Schema additions to express carve-out scope and PO-rebate thresholds
- UI wiring in the contract-terms entry + display components
- Unit tests with worked examples per type
- Compare-card rendering for the list page

### Documented roadmap (v2+)

The remaining 10 `TermType` values get a sub-section in §5 describing the math and the engine plan. Not implemented in v1 — but documented so future specs can pick them up without re-deriving the approach:

- `volume_rebate` — rebate on unit count rather than dollars
- `price_reduction` — upfront discount, not a post-facto rebate
- `market_share` — rebate when market-share commitment met
- `market_share_price_reduction` — hybrid
- `capitated_price_reduction` — price caps per period
- `capitated_pricing_rebate` — rebate within price caps
- `payment_rebate` — rebate on timely payment
- `growth_rebate` — YoY growth vs baseline
- `compliance_rebate` — rebate when compliance rate hit
- `fixed_fee` — flat payment
- `locked_pricing` — no rebate, just price lock
- `rebate_per_use` — per-procedure or per-unit flat

### Out of scope

- **Implementation** of the v2 types listed above. Documentation only.
- **Multi-term composition math.** If a contract has multiple terms simultaneously (e.g., `spend_rebate` + `carve_out`), v1 handles them by running the main engine with the carve-out applied as a filter. Complex multi-term interactions (e.g., `growth_rebate` combined with `market_share`) are reserved for their respective v2 specs.
- **Vendor portal carve-out negotiation UX.** Vendor submits carve-outs via the standard pending-contract flow; no special propose-carve-out UX.
- **Backfill of historical rebates** under new engines. Existing accruals stay as-is; only new calculations use the new engines.

### Non-goals (preserved)

- No stack swaps. No schema regressions. No breaking changes to already-shipped contracts-rewrite numbers.

---

## 2. Translation notes

| Prototype pattern | Tydei equivalent |
|---|---|
| Everything is `spend_rebate` with ad-hoc conditionals | Typed dispatch on `ContractTerm.termType` into dedicated pure engines |
| Carve-out as a comment on the contract | Typed `ContractTermCarveOutRule` rows with explicit scope (items + categories) |
| PO rebate mixed with cumulative | Distinct engine; applies per-PO, never aggregates |

---

## 3. Data model changes

Additive. One migration pass.

### 3.1 Carve-out scope — `ContractTermCarveOutRule`

Carve-outs need to express *what's excluded*: specific items, entire categories, or a vendor-level carve.

```prisma
enum CarveOutScope {
  item           // exclude specific vendorItemNo
  category       // exclude all items matching a product category
  vendor         // exclude all items from a sub-vendor (division)
}

model ContractTermCarveOutRule {
  id              String   @id @default(cuid())
  termId          String
  scope           CarveOutScope
  // exactly one of these is set per rule, validated at the action layer:
  vendorItemNo    String?  // when scope = item
  productCategoryId String? // when scope = category
  vendorId        String?  // when scope = vendor (must be a sub-vendor / division)
  createdAt       DateTime @default(now())

  term            ContractTerm @relation(fields: [termId], references: [id], onDelete: Cascade)
  productCategory ProductCategory? @relation(fields: [productCategoryId], references: [id])
  vendor          Vendor? @relation(fields: [vendorId], references: [id])

  @@index([termId])
  @@index([vendorItemNo])
  @@map("contract_term_carve_out_rule")
}
```

### 3.2 PO rebate thresholds — reuse `ContractTier`

No new model needed. `ContractTier.spendMin` + `ContractTier.rebateValue` already express "spend ≥ X gets Y%"; for `po_rebate`, the engine interprets `spendMin` as **per-PO spend threshold** rather than cumulative. A flag on the parent `ContractTerm` tells the engine which interpretation to use.

**Extension on `ContractTerm`:**

```prisma
model ContractTerm {
  // ... existing fields from contracts-rewrite (rebateMethod, etc.)

  // PO-rebate specific — inherited by tiers
  poRebateApplyMode  POApplyMode @default(tier_by_po)  // how to apply tier thresholds
}

enum POApplyMode {
  tier_by_po          // tier applies per-PO individually (default for po_rebate)
  tier_by_cumulative  // tier applies on cumulative contract spend (default for spend_rebate)
}
```

**Rationale for the enum over a boolean:** gives room for future modes (e.g., `tier_by_quarter` for quarterly-PO aggregations) without another migration.

### 3.3 No other schema changes

Everything else is engine code + UI.

---

## 4. Subsystems — priority-ordered

### Subsystem 0 — Schema migration + engine dispatcher (P0)

**Priority:** P0 — blocks 1-6.

**Files:**
- Modify: `prisma/schema.prisma` — add `CarveOutScope` enum, `POApplyMode` enum, `ContractTermCarveOutRule` model, `ContractTerm.poRebateApplyMode` column
- Modify: `lib/rebates/calculate.ts` — add `calculateRebateByTermType(term, context)` dispatcher that routes to the per-type engine; `spend_rebate` stays in the existing path (backward-compat)
- Create: `lib/rebates/dispatcher.ts` — the dispatcher + `RebateContext` type

**Dispatcher shape:**

```ts
interface RebateContext {
  contractId: string
  facilityIds: string[]       // from resolveContractFacilities
  cumulativeSpend: number     // pre-computed by caller
  perPOSpend?: PerPOSpend[]   // required for po_rebate
  cogRecords?: COGRecord[]    // required for carve_out filtering
}

export function calculateRebateByTermType(
  term: ContractTerm & { tiers: ContractTier[]; carveOutRules: ContractTermCarveOutRule[] },
  context: RebateContext,
): RebateResult {
  switch (term.termType) {
    case "spend_rebate":   return calculateSpendRebate(term, context)
    case "carve_out":      return calculateCarveOutRebate(term, context)
    case "po_rebate":      return calculatePORebate(term, context)
    // v2 types fall through to a null-result stub with a logged warning
    default:
      console.warn(`[rebates] unhandled term type: ${term.termType}`)
      return { tierAchieved: 0, rebatePercent: 0, rebateEarned: 0, rebateCollected: 0 }
  }
}
```

**Acceptance:**
- `bunx prisma validate` → valid.
- `bun run db:push` → in sync, zero data-loss warnings.
- `bunx tsc --noEmit` → 0 errors.
- Dispatcher exists, compiles, routes correctly for `spend_rebate` (existing behavior preserved).
- Existing contracts-rewrite tests still pass (no regression).

**Plan detail:** On-demand — `00-schema-dispatcher-plan.md`.

---

### Subsystem 1 — Carve-out engine (P0)

**Priority:** P0.

**Files:**
- Create: `lib/rebates/carve-out.ts`
- Create: `lib/rebates/__tests__/carve-out.test.ts`

**Semantics:**

A `carve_out` term's rebate is computed as **the main rebate from the sibling `spend_rebate` term(s) on the same contract, with the carve-out scope excluded** from the spend total. If the contract has no other rebate term, a `carve_out`-only contract earns zero (it's a pure exclusion rule — needs a companion term).

**Algorithm:**

```
calculateCarveOutRebate(carveOutTerm, context):
  // Find the sibling spend_rebate term(s) on the same contract
  siblingTerms = getSiblingRebateTerms(contract.terms, excludeId=carveOutTerm.id, types=["spend_rebate"])
  if siblingTerms.length === 0: return { rebateEarned: 0, rebateCollected: 0 } // carve-out-only contract

  // Build the exclusion filter from carve-out rules
  excludedItems     = carveOutTerm.carveOutRules.filter(r => r.scope === "item").map(r => r.vendorItemNo)
  excludedCategories = carveOutTerm.carveOutRules.filter(r => r.scope === "category").map(r => r.productCategoryId)
  excludedVendors    = carveOutTerm.carveOutRules.filter(r => r.scope === "vendor").map(r => r.vendorId)

  // Filter COG records
  filteredCogRecords = context.cogRecords.filter(record =>
    !excludedItems.includes(record.vendorItemNo) &&
    !excludedCategories.includes(record.productCategoryId) &&
    !excludedVendors.includes(record.vendorId)
  )

  // Recompute cumulative spend on filtered set
  filteredSpend = filteredCogRecords.reduce((sum, r) => sum + r.extendedPrice, 0)

  // Run the main engine with the reduced spend
  // (Use the highest-level sibling term — typically there's just one)
  mainTerm = siblingTerms[0]
  return calculateSpendRebate(mainTerm, { ...context, cumulativeSpend: filteredSpend })
```

**Important:** This means a carve-out rebate is always reported against the sibling `spend_rebate` term's tiers. The `carve_out` term itself has no tiers of its own — it's an exclusion rule modifying the sibling's calculation.

**Worked example** (test):

- Contract has two terms: `spend_rebate` (3 tiers: 2% / 3% / 4% at $0 / $50K / $100K) + `carve_out` (excludes category "Implants")
- Cumulative vendor spend: $120K
- Implants spend in that: $30K
- Non-carved spend: $90K
- `spend_rebate` alone on $120K (cumulative method) = $4,800 (tier 3: $120K × 4%)
- With carve-out: $90K × 3% (tier 2) = $2,700 (because after carving $30K of implants, total is $90K which is tier 2)

**Acceptance:**
- Engine returns 0 for a carve-out-only contract with no sibling rebate term.
- Single-category carve-out reduces spend correctly.
- Multi-rule carve-out (items + categories + sub-vendors) composes correctly.
- Non-matching COG records aren't carved.
- Tests cover the worked example and at least 6 edge cases (empty rules, all-items-carved, cross-facility contracts, marginal method compatibility, etc.).

**Plan detail:** On-demand — `01-carve-out-plan.md`.

---

### Subsystem 2 — PO rebate engine (P0)

**Priority:** P0.

**Files:**
- Create: `lib/rebates/po-rebate.ts`
- Create: `lib/rebates/__tests__/po-rebate.test.ts`

**Semantics:**

A `po_rebate` term has tiers interpreted **per-PO**, not cumulatively. The engine walks each purchase order, applies the highest-qualifying tier to that PO's total, and sums the per-PO rebates.

**Algorithm:**

```
calculatePORebate(term, context):
  if !context.perPOSpend: throw Error("po_rebate requires perPOSpend context")

  let totalRebate = 0
  const poBreakdown: { poNumber, spend, tierAchieved, rebate }[] = []

  for po in context.perPOSpend:
    // Find the highest tier this PO qualifies for (sorted descending by spendMin)
    const tier = term.tiers
      .filter(t => po.spend >= t.spendMin)
      .sort((a, b) => b.spendMin - a.spendMin)[0]

    if tier:
      const rebate = po.spend × (tier.rebateValue / 100)
      totalRebate += rebate
      poBreakdown.push({ poNumber: po.poNumber, spend: po.spend, tierAchieved: tier.tierNumber, rebate })
    else:
      poBreakdown.push({ poNumber: po.poNumber, spend: po.spend, tierAchieved: 0, rebate: 0 })

  return {
    rebateEarned: totalRebate,
    rebateCollected: totalRebate × (opts.collectionRate ?? DEFAULT_COLLECTION_RATE),
    tierAchieved: 0, // N/A for PO rebate — different PO can hit different tiers
    rebatePercent: 0, // N/A for same reason
    poBreakdown, // extended metadata for UI
  }
```

**Important:** `tierAchieved` is meaningless at the term level for PO rebates (different POs hit different tiers). UI should render the per-PO breakdown instead of a single tier summary.

**Worked example** (test):

- Contract term: `po_rebate` with tiers `[$0+: 0%, $5K+: 3%, $10K+: 5%]`
- PO history: `PO-001 $3,000`, `PO-002 $6,000`, `PO-003 $12,000`, `PO-004 $15,000`
- Per-PO rebates: `$0`, `$6K × 3% = $180`, `$12K × 5% = $600`, `$15K × 5% = $750`
- Total: `$1,530`

Cumulative interpretation would give `$36K × 5% = $1,800` — different result, shows why the PO mode matters.

**Acceptance:**
- Per-PO breakdown returns correct tier per PO.
- Total matches worked example.
- PO with zero qualifying tier returns `rebate: 0` (no base tier unless tier 1 has `spendMin: 0`).
- Engine throws typed error when `perPOSpend` context missing.
- Integration: `lib/actions/contracts.ts::getContractMetrics` extended to provide `perPOSpend` when contract has a `po_rebate` term.

**Plan detail:** On-demand — `02-po-rebate-plan.md`.

---

### Subsystem 3 — UI: carve-out rules editor + PO-rebate mode toggle (P1)

**Priority:** P1.

**Files:**
- Modify: `components/contracts/contract-terms-entry.tsx` — term-type-aware rendering:
  - When `termType === "carve_out"`: render a rule builder (add-row, scope picker [item/category/vendor], value picker)
  - When `termType === "po_rebate"`: render existing tier editor but labels switched to "per-PO threshold"; show a small "per-PO mode" indicator
- Modify: `components/contracts/contract-terms-display.tsx` — display the right summary per type:
  - Carve-out: "Excludes: 3 items, 1 category"
  - PO rebate: per-PO breakdown table with columns PO # / Spend / Tier / Rebate

**Acceptance:**
- Users can create + edit both term types via the UI.
- Display components show the right shape per type.
- No crash on existing contracts with other term types (fall through to a "Term type: X — display coming soon" placeholder).

**Plan detail:** On-demand — `03-ui-plan.md`.

---

### Subsystem 4 — Integration into list + detail pages (P1)

**Priority:** P1.

**Files:**
- Modify: `lib/actions/contracts.ts::getContractMetricsBatch` (from contracts-list-closure spec subsystem 1) — call `calculateRebateByTermType` per term instead of the hardcoded `spend_rebate` path
- Modify: `components/contracts/contracts-list-client.tsx` — ensure Rebate Earned column renders carve-out and PO-rebate totals correctly
- Modify: `components/contracts/contract-detail-client.tsx` — compact PO breakdown rendered when contract has `po_rebate`

**Acceptance:**
- List page shows correct rebate for all 3 supported term types: `spend_rebate`, `carve_out`, `po_rebate`.
- Detail page shows per-PO table when applicable.
- No regression on `spend_rebate` display or numbers.

**Plan detail:** On-demand — `04-integration-plan.md`.

---

### Subsystem 5 — Documentation + v2 roadmap (P2)

**Priority:** P2.

**Files:**
- Create: `docs/architecture/rebate-term-types.md` — one section per `TermType` value with status + formula sketch + implementation notes
- Modify: `CLAUDE.md` — pointer to the new doc

**Coverage per doc section (v2 items — documentation only, no code):**

- `volume_rebate` — formula: `totalUnits × rebatePerUnit`. Tier structure applies to unit counts. Implementation: new engine `lib/rebates/volume.ts`; context needs `totalUnits`.
- `price_reduction` — not a rebate; shifts list→contract price. Rebate engine returns 0; price-variance engine (subsystem 5 of contracts-rewrite) already handles the variance side.
- `market_share` — formula: `rebate if currentMarketShare ≥ commitmentPercent`; amount is flat or tier-based. Requires market-share calc + commitment tracking.
- `market_share_price_reduction` — hybrid; market-share unlocks price reduction on qualifying items.
- `capitated_price_reduction` — price cap: `min(listPrice, capPrice)` applies, spend over cap returns as rebate.
- `capitated_pricing_rebate` — rebate on spend within cap.
- `payment_rebate` — rebate on `paidOnTime` fraction of invoices.
- `growth_rebate` — rebate on YoY growth: `max(0, currentSpend - priorPeriodSpend) × rate`.
- `compliance_rebate` — rebate unlocked when compliance rate hits threshold.
- `fixed_fee` — flat dollar payment; no calculation needed.
- `locked_pricing` — no rebate; pricing lock behavior lives in contract-pricing table.
- `rebate_per_use` — per-procedure or per-unit flat rebate; needs case-costing integration for procedure-based.

**Acceptance:**
- Each v2 type has a doc section with formula, required context, integration plan.
- Doc cross-linked from CLAUDE.md.

**Plan detail:** On-demand — `05-docs-roadmap-plan.md`.

---

## 5. Execution model

**Sequencing:**

```
Subsystem 0 (schema + dispatcher)
  ↓
Subsystem 1 (carve-out engine)   Subsystem 2 (PO rebate engine)
  ↓                                 ↓
         Subsystem 3 (UI)
                ↓
         Subsystem 4 (integration)
                ↓
         Subsystem 5 (docs)
```

Subsystems 1 + 2 parallelizable after 0.

**Per-subsystem cadence:** same as prior specs.

**Global verification:**

```bash
bunx tsc --noEmit
bun run lint
bun run test
bun run build
bun run db:seed
```

Plus:
```bash
bun run test lib/rebates/__tests__/carve-out.test.ts
bun run test lib/rebates/__tests__/po-rebate.test.ts
bun run test lib/contracts/__tests__/dispatcher.test.ts
```

---

## 6. Acceptance (whole extension)

- All 5 subsystems merged to main.
- Contracts with `carve_out` terms compute correctly on list + detail pages.
- Contracts with `po_rebate` terms show per-PO breakdown on detail page.
- Contracts with `spend_rebate` unchanged (no regression).
- Unknown term types log a warning and return zero (soft-fail).
- `docs/architecture/rebate-term-types.md` documents all 15 term types with v1 (implemented) or v2 (roadmap) status.

---

## 7. Known risks

1. **Carve-out + marginal method interaction.** If a contract has `spend_rebate` with marginal method + carve-out, the carve-out reduces spend before tiers apply. Tests must cover both method + carve-out combinations.
2. **`po_rebate` context cost.** Fetching every PO's spend per-contract-per-render could be expensive. Mitigation: cache `perPOSpend` in TanStack Query; recompute only when COG data invalidates.
3. **Sibling-term resolution ambiguity.** A contract with multiple `spend_rebate` terms + one `carve_out` — which sibling does the carve-out apply to? V1 rule: all `spend_rebate` terms share a single carve-out rule set. If vendor submits a contract with multiple sibling terms, UI flags for clarification.
4. **Schema migration impact on seed data.** Existing seeded contracts don't have carve-out rules or `poRebateApplyMode` — defaults handle this (no rules = no carve-out; default `tier_by_cumulative` for non-PO terms).
5. **V2 types returning 0 could look like bugs.** Mitigation: dispatcher logs a warning with term type + contract id; a "term type X not fully implemented — see roadmap" badge on the UI when the engine detects an un-handled type.

---

## 8. Out of scope (explicit)

- **Engine implementation** of the 12 v2 `TermType` variants — documentation only.
- **Multi-term composition math** beyond carve-out + spend-rebate pairing.
- **Vendor-side carve-out negotiation UX** — vendors submit via standard pending-contract flow.
- **Historical rebate backfill** under new engines — only new calculations use new engines.
- **Rebate splits across facilities** for carve-out or po_rebate specifically — uses the same `splitRebateByFacility` from platform-data-model subsystem 4.

---

## 9. How to iterate

1. Pick a subsystem (start with 0).
2. Generate per-subsystem plan via superpowers:writing-plans.
3. Execute; commit each separately.
4. Verify; merge; proceed.
