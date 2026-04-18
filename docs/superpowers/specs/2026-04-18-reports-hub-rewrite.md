# Reports Hub Rewrite — Design Spec

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement the subsystems below. Each subsystem gets its own per-subsystem TDD plan generated on demand. Steps use checkbox (`- [ ]`) syntax for tracking.

**Date:** 2026-04-18
**Branch:** continue in `contracts-rewrite-00-schema`
**Status:** Design approved by Vick (2026-04-18) via batch approval
**Brainstormed via:** superpowers:brainstorming
**Related specs:**
- Required dependency: `2026-04-18-contracts-rewrite.md` (rebate engines + accrual)
- Required dependency: `2026-04-18-cog-data-rewrite.md` (enriched COG for report aggregates)
- Required dependency: `2026-04-18-data-pipeline-rewrite.md` (price-discrepancy aggregator — this spec leaves that page alone, only adds the reports hub around it)
- Required dependency: `2026-04-18-rebate-term-types-extension.md` (per-contract-type report math)
- Required dependency: `2026-04-18-platform-data-model-reconciliation.md` (vendor + facility scope)

**Goal:** Rewrite `/dashboard/reports` as the **multi-contract-type performance reporting hub** with 6 report-type tabs + Overview + Calculations audit trail. The companion `/dashboard/reports/price-discrepancy` page is already covered by the data-pipeline spec; this spec adds the *hub* that routes into it.

**Architecture:** Single hub page with tab-routed views. Each tab is a focused sub-component pulling pre-aggregated data from server actions. The "Calculations" tab is the most detailed surface — a full audit trail of how each rebate figure was computed, showing every PO and item that contributed or was excluded.

**Tech Stack (unchanged):** Next.js 16, Prisma 7, TanStack Query, recharts, Zod, shadcn/ui.

---

## 1. Scope

### In scope

- **Hub page** (`/dashboard/reports`) with 8 tabs:
  - **Overview** — cross-cutting summary (contract lifecycle pie + monthly spend/rebate trend)
  - **Usage** — `usage` contract performance
  - **Capital** — `capital` contract performance
  - **Service** — `service` contract performance
  - **Tie-In** — `tie_in` contract performance
  - **Grouped** — multi-facility / GPO performance
  - **Pricing** — `pricing_only` contract performance
  - **Calculations** — full audit trail
- **Dynamic tab visibility** — when a specific contract is selected, hide non-matching tabs
- **Vendor + Contract cascade filter** — selecting vendor resets contract; selecting contract auto-routes to matching tab
- **Date range picker** (9 presets shared with case-costing reports spec)
- **Calculation audit trail tab** — per-tier structure, rebate formula, excluded PO list with reasons (off-contract, out-of-scope, etc.)
- **Quick Access cards** — 3 entry points (full reports, price discrepancy drill-down, scheduled reports)
- **Scheduled reports** — list of active `ReportSchedule` rows with edit / delete / pause actions
- **Export actions** — CSV for each tab
- **Tech debt:** audit `lib/actions/reports.ts` (199 lines) for split opportunities

### Out of scope

- **Price discrepancy page** — already covered in data-pipeline-rewrite subsystem 5
- **Cron-based scheduled report dispatch** — reports-hub lists `ReportSchedule` and lets user edit, but the actual cron delivery is future notification-delivery spec
- **PDF export** — CSV only in v1
- **Custom report builder** (user-defined metrics + groupings) — out of scope
- **Emailed reports auto-deliver** — `ReportSchedule` UI works; delivery requires cron infra
- **Cross-tenant reports** — scoped to user's active facility or health-system cascade

### Non-goals (preserved)

- No stack swaps. No new external dependencies.

---

## 2. Translation notes — canonical prototype → tydei

| Prototype pattern | Tydei equivalent |
|---|---|
| `mockContracts` local array | `prisma.contract.findMany({where: {facilityId}})` via server action |
| Vendor → Contract filter cascade in client state | Same pattern; URL-synced filter state |
| `contract.type → typeMapping → setSelectedReportType` | Same logic; typed enum mapping |
| Calculation audit: walk every PO + item included/excluded | Server-side `getRebateCalculationAudit(contractId)` — reuses contracts-rewrite engines + enriched COG data |
| Tier "applied RETROACTIVELY" definition copy | Same; served as tooltip copy |
| Hardcoded report data + formulas | Reuse `computeRebateFromPrismaTiers`, `calculateTierProgress`, `buildMonthlyAccruals` from contracts-rewrite |
| `ReportSchedule` ad-hoc mock | Real `ReportSchedule` Prisma model (exists) |

---

## 3. Data model changes

**None.** `ReportSchedule` already exists. Reports are computed on-demand, not persisted.

---

## 4. Subsystems — priority-ordered

### Subsystem 0 — Data audit + aggregation actions (P0)

**Priority:** P0.

**Files:**
- Audit: `lib/actions/reports.ts` (199 lines) — catalog functions
- Create: `lib/actions/reports/overview.ts` — `getReportsOverview(facilityId, dateRange)`:
  - Contract lifecycle distribution (active / expiring / expired counts)
  - Monthly spend + rebate trend (12 months)
- Create: `lib/actions/reports/per-type.ts` — one action per contract type returning the metrics canonical doc §1 lists
- Create: `lib/actions/reports/audit-trail.ts` — `getRebateCalculationAudit(contractId)` returns the full audit: tier table + formula explanation + per-PO breakdown (included / excluded with reasons)
- Create: `lib/actions/reports/schedule.ts` — CRUD on `ReportSchedule` rows

**Audit trail shape:**

```ts
interface RebateCalcAudit {
  contract: { id, name, vendor, type, effectiveDate, expirationDate }
  tiers: Array<{ name, minSpend, maxSpend, rebateRate }>
  currentTier: string
  tierDefinition: string
  calc: {
    totalEligibleSpend: number
    currentTierRate: number
    grossRebate: number
    exclusions: Array<{
      category: 'off_contract' | 'out_of_scope' | 'excluded_item' | 'carve_out'
      amount: number
      description: string
    }>
    netRebate: number
  }
  inclusions: Array<{ poNumber, date, amount, status: 'included' }>
  excludedPOs: Array<{ poNumber, date, amount, reason: string }>
}
```

**Acceptance:**
- All 8 tabs have a corresponding data action.
- Audit trail action returns complete breakdown.
- `bunx tsc --noEmit` → 0 errors.

**Plan detail:** On-demand — `00-data-actions-plan.md`.

---

### Subsystem 1 — Hub page + tab routing (P1)

**Priority:** P1.

**Files:**
- Modify: `app/dashboard/reports/page.tsx` — tab container with URL-synced active tab
- Create: `components/facility/reports/reports-client.tsx` — orchestrator (≤200 lines)
- Create: `components/facility/reports/reports-filter-bar.tsx` — vendor + contract + date-range cascading filters
- Create: `components/facility/reports/reports-tab-router.tsx` — computes `availableTabs` + hides non-matching

**Tab visibility logic:**

```ts
if (selectedContract === 'all') {
  availableTabs = ['overview', 'usage', 'capital', 'service', 'tie_in', 'grouped', 'pricing_only', 'calculations']
} else {
  const contract = getContract(selectedContract)
  const typeTab = { usage:'usage', capital:'capital', service:'service', tie_in:'tie_in', grouped:'grouped', pricing_only:'pricing_only' }[contract.type]
  availableTabs = [typeTab, 'overview', 'calculations']
}
```

**Auto-route to matching tab** on contract-change: if current active tab isn't in `availableTabs`, fall back to `overview`.

**Acceptance:**
- URL sync works; refresh preserves filter + tab state.
- Auto-tab-route works when selecting a specific contract.
- Manual tab switch respected within allowed set.

**Plan detail:** On-demand — `01-hub-tab-routing-plan.md`.

---

### Subsystem 2 — Overview tab (P1)

**Priority:** P1.

**Files:**
- Create: `components/facility/reports/overview-tab.tsx`
- Sub-components:
  - Contract lifecycle pie (recharts)
  - Monthly spend + rebate trend (line chart)
  - Quick stats row (total contracts, total spend YTD, total rebates YTD, total opportunities)

**Acceptance:**
- Charts render with real data.
- Empty state when no contracts.
- Responsive down to `sm`.

**Plan detail:** On-demand — `02-overview-tab-plan.md`.

---

### Subsystem 3 — Per-type tabs (P1)

**Priority:** P1.

**Files:**
- Create one component per tab:
  - `components/facility/reports/usage-tab.tsx`
  - `components/facility/reports/capital-tab.tsx`
  - `components/facility/reports/service-tab.tsx`
  - `components/facility/reports/tie-in-tab.tsx`
  - `components/facility/reports/grouped-tab.tsx`
  - `components/facility/reports/pricing-tab.tsx`

**Per-type metrics:**

| Tab | Columns |
|---|---|
| Usage | Contract, Spend, Volume, Rebate Earned, Rebate Collected, Uncollected |
| Capital | Contract, Total Value, Payment Schedule (installments remaining), Depreciation to Date |
| Service | Contract, Payment Expected, Payment Actual, Balance Expected, Balance Actual |
| Tie-In | Contract, Spend Target / Actual, Volume Target / Actual, Rebate Earned, Bundle Status |
| Grouped | Contract, Facilities Count, Total Spend, Per-Facility Breakdown |
| Pricing | Contract, Contract Price vs Paid Price variance, Savings / Overpay |

**Acceptance:**
- Each tab renders a table + summary stat row.
- Sort + filter within tab (client-side).
- Row click → contract detail page.

**Plan detail:** On-demand — `03-per-type-tabs-plan.md`.

---

### Subsystem 4 — Calculations audit trail tab (P1)

**Priority:** P1.

**Files:**
- Create: `components/facility/reports/calculations-tab.tsx`
- Requires a selected contract (shows a picker otherwise)

**Displays (per canonical doc §4):**
1. **Contract info card** — name, vendor, type, effective + expiration dates (§4.1)
2. **Tier structure table** — rate per tier, min/max spend, current-tier indicator, retroactive-application tooltip (§4.2)
3. **Rebate calculation display** (§4.3):
   - `totalEligibleSpend`
   - `currentTierRate`
   - `grossRebate = eligibleSpend × tierRate`
   - **Adjustments** — signed list (e.g., `Administrative fee (2%) -1,014`, `Early payment credit +500`)
   - `netRebate = grossRebate + sum(adjustments)`
   - Plain-English `formula` and algebraic `detailedFormula` strings (copyable)
4. **Eligible purchases table** (§4.4) — per-PO per-item with columns: PO, Date, Item, Description, Qty, Unit Price, Ext Price, Eligible?, Rebate Amount, Exclusion Reason
5. **Exclusions summary** grouped-by-category (§4.5):
   | Category | Reason | Item Count | Total Value |
   | Service & Repairs | Section 4.2 | 3 | $7,500 |
   - Pulls from enriched COG `matchStatus` (out_of_scope / off_contract_item / price_variance) + contract carve-outs (rebate-term-types spec)
6. **Tier progress projection** (§4.6):
   - `currentSpend`, `nextTierThreshold`, `spendNeeded`, `nextTierRate`
   - `additionalRebateIfReached = spendNeeded × (nextRate - currentRate)`
   - Projection string: `"At current monthly rate of $X, Tier N reached in Y.Y months"` based on trailing-3-month spend velocity
   - Hidden when already at top tier or zero eligible spend

**Acceptance:**
- Every number traceable to a source row or formula.
- Exclusion reasons pull real reasons from match algorithm (`out_of_scope`, `off_contract_item`, `carve_out`, `price_variance`).
- Copy button on formula displays.
- Adjustments display handles empty + multi-line correctly.
- Tier progress projection hides gracefully when spend velocity is zero.

**Plan detail:** On-demand — `04-calc-audit-tab-plan.md`.

---

### Subsystem 5 — Quick Access cards + scheduled reports (P2)

**Priority:** P2.

**Files:**
- Create: `components/facility/reports/quick-access-cards.tsx` — 3 cards:
  - **Full Reports** (stays on this page)
  - **Price Discrepancy Drill-Down** (navigates to `/dashboard/reports/price-discrepancy`)
  - **Scheduled Reports** (opens schedule dialog)
- Create: `components/facility/reports/scheduled-reports-dialog.tsx`:
  - List of `ReportSchedule` rows — columns: `name`, `type`, `frequency`, `nextRun`, `recipients[]`
  - Edit / pause / delete actions
  - "New Schedule" form with fields (per canonical §6):
    - `name` (string)
    - `reportType` (usage | capital | service | tie_in | grouped | pricing_only | discrepancy)
    - `frequency` (daily | weekly | monthly | quarterly)
    - `recipients` (email[] — comma-separated input, validated)
    - `includeCharts` (bool toggle)
    - `includeLineItems` (bool toggle)
    - filter preset (inherit current filters on create)
  - Banner: "Scheduled delivery is in development. These settings will apply once the scheduled job goes live." (same pattern as renewals spec's alert settings)

**Acceptance:**
- CRUD on `ReportSchedule` works; persists across reloads.
- Banner visible and non-dismissable.
- Delivery not wired (consistent with "settings UI only, delivery deferred" pattern).

**Plan detail:** On-demand — `05-quick-access-scheduled-plan.md`.

---

### Subsystem 6 — CSV export (P2)

**Priority:** P2.

**Files:**
- Create: `lib/reports/export.ts` — per-tab CSV builders
- Export button on each tab → downloads current filter state's data

**Acceptance:**
- Each tab exports to CSV correctly.
- Audit-trail tab exports include both inclusions + exclusions.

**Plan detail:** On-demand — `06-export-plan.md`.

---

### Subsystem 7 — UI polish (P2)

Standard polish — empty states, a11y, responsive, hydration.

**Plan detail:** On-demand — `07-ui-polish-plan.md`.

---

## 5. Execution model

```
Subsystem 0 (data actions)
  ↓
Subsystem 1 (hub + tab routing)
  ↓
Subsystem 2 (overview)   Subsystem 3 (per-type tabs)   Subsystem 4 (audit tab)
  ↓                        ↓                             ↓
         Subsystem 5 (quick access + scheduled)
                ↓
         Subsystem 6 (CSV export)
                ↓
         Subsystem 7 (UI polish)
```

**Global verification** — same as prior specs.

---

## 6. Acceptance

- All 8 subsystems merged.
- Hub renders 8 tabs with real data from aggregation actions.
- Dynamic tab visibility correct.
- Audit-trail tab produces complete breakdown.
- Scheduled reports UI works; banner signals delivery deferral.
- CSV exports per-tab work.
- `bunx tsc --noEmit` → 0; `bun run test` → passing.

---

## 7. Known risks

1. **Audit trail query cost.** Walking every PO + item for calculation display can be slow on large contracts. Mitigation: paginate included/excluded POs; lazy-load on tab activation.
2. **Tab state complexity.** URL-synced + filter-driven + auto-routed = many state interactions. Mitigation: single source of truth via `useSearchParams` + derived state.
3. **ReportSchedule without delivery.** Users schedule reports that never fire. Mitigation: prominent banner + disabled action button with tooltip; docs page explains.
4. **Per-type metric drift.** Each contract type has distinct metrics; formulas must stay in sync with contracts-rewrite engines. Mitigation: per-tab plan cites the exact contracts-rewrite function used.
5. **Overview pie accuracy with partial data.** A facility with 3 contracts produces a thin pie. Mitigation: threshold where pie falls back to a bar chart with clearer labels.

---

## 8. Out of scope (explicit)

- Price discrepancy page (data-pipeline-rewrite owns)
- Cron-based report delivery
- PDF export
- Custom report builder
- Cross-tenant reports

---

## 9. How to iterate

1. Start with subsystem 0.
2. Generate per-subsystem plan via superpowers:writing-plans.
3. Execute; commit each separately.
4. Verify; merge; proceed.
