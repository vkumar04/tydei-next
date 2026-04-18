# Contracts List Page — Closure Spec

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement the subsystems below. Each subsystem gets its own per-subsystem TDD plan generated on demand. Steps in those plans use checkbox (`- [ ]`) syntax for tracking.

**Date:** 2026-04-18
**Branch:** continue in `contracts-rewrite-00-schema`
**Status:** Design approved by Vick (2026-04-18)
**Related specs:**
- Shipped: `2026-04-18-contracts-rewrite.md` (12 commits on main; covered list-page polish at a high level in subsystem 8)
- Required dependency: `2026-04-18-platform-data-model-reconciliation.md` (vendor resolve, 3-way facility scope, contract dedup)
- Foundation: `2026-04-18-ai-integration-foundation.md` (AI match-status explainer available on drilldown)

**Goal:** Close the 30% remaining gap between the contracts-rewrite subsystem 8 list-page polish and the canonical contracts-list functional spec. Ship the last pieces users will notice — merged pending/active view, live per-row metrics, complete 5-card comparison, 3-way facility filter — and split the two mega-files touching the contract-create flow while we're in there.

**Architecture:** Gap-closure on a working surface. Current state:
- `components/contracts/contracts-list-client.tsx` — 526 lines (the canonical doc references a 992-line v0 source; tydei's is leaner because of the server-action split)
- `components/contracts/contract-columns.tsx` — 192 lines
- `components/contracts/contract-filters.tsx` — 97 lines
- `components/contracts/new-contract-client.tsx` — 950 lines (⚠️ mega-file)
- `components/contracts/contract-form.tsx` — 904 lines (⚠️ mega-file)
- `lib/actions/contracts.ts` — 878 lines (grew during contracts-rewrite; warrants audit)

Most subsystems are small — audit + wire + polish. The two mega-files get split as tech debt.

**Tech Stack (unchanged):** Next.js 16, Prisma 7, Better Auth, Tailwind v4, shadcn/ui, TanStack Query, Zod, Bun.

---

## 1. Scope

### In scope

- **Merged list** — system contracts + vendor-submitted pending contracts appear in one table with a `source` discriminator (`system` | `vendor`) and a status column that understands both lifecycle states
- **Live per-row metrics** — each row shows COG-backed spend + computed rebate + total value, with fallback to stored values when COG has no matches
- **Summary stats cards** (ignore filters) — Total Contracts, Total Value, Total Rebates Earned
- **3-way facility filter** — single `facilityId` + multi `facilities[]` + group `selectedFacilities[]` (via `ContractFacility` join table); deduped dropdown populated from both contracts and the active facility registry
- **Five compare cards** — Overview, Rebate Terms, Financial Performance, Pricing Items, Contract Terms (two may already exist; verify + complete)
- **Score badge column** — render from contracts-rewrite's `Contract.score` (if populated)
- **Delete flow** — confirmation dialog → typed action → TanStack invalidation. Vendor-submitted contracts route to the pending-contracts delete path.
- **Tech debt:**
  - Split `components/contracts/new-contract-client.tsx` (950 lines) into focused files
  - Split `components/contracts/contract-form.tsx` (904 lines) into focused files
  - Audit `lib/actions/contracts.ts` (878 lines); surface dead code / over-long functions
  - Retire any duplicated filter/search logic between list + filters components

### Out of scope

- **`window.__cogRecordsCache` global** from the canonical doc. Prototype artifact; tydei uses TanStack Query cache.
- **Skeleton pre-mount `mounted` flag.** Tydei uses Suspense + TanStack's `isPending`.
- **Vendor-contract revision_requested status surfaced in this page.** Exists in `PendingContractStatus`; surfacing lives in pending-tab UX, not facility list.
- **Amendment flow changes.** Already shipped in contracts-rewrite subsystem 8 Part 1.
- **Compare-to-URL sync.** Local state only.
- **Bulk contract delete.** One at a time via dropdown.
- **AI advisors beyond match-status explainer.** The list page has no upload flow or dedup need.

### Non-goals (preserved)

- No stack swaps. No re-architecture of the contracts page beyond the stated gaps.
- No amendments to already-shipped contracts-rewrite commits.

---

## 2. Translation notes — canonical → tydei

| Canonical prototype pattern | Tydei equivalent |
|---|---|
| `initializeContracts()` + merge system + vendor arrays in client | Server action `getMergedContracts(facilityId, filters)` returns pre-merged shape |
| `window.__cogRecordsCache` global | Per-contract metrics computed server-side on demand or from existing `getContract` cache; list uses aggregate `getContractMetrics(contractIds[])` |
| `localStorage['tydei_facilities']` + augment from vendor contracts | `prisma.facility.findMany({ where: { status: "active" } })`; facility dropdown built from `ContractFacility` joins + active facility registry deduped by id |
| 3 `window` event listeners | TanStack Query invalidation on mutation success |
| `calculateRebateFromTerms(id, spend)` local function | `computeRebateFromPrismaTiers(spend, tiers, { method })` from contracts-rewrite subsystem 1 |
| `getContractSpendFromCOGData(id, cogRecords)` local function | Server-side COG aggregate via `getContractSpend(contractId)` action; reuses the enrichment columns from COG rewrite |
| Skeleton via `mounted` state | Suspense + TanStack's `isPending` |
| Fallback tier percentages `[0, 2, 4, 6, 8]` | Dropped. Real `ContractTier.rebateValue`; missing tiers default to 0 |

---

## 3. Data model changes

**None.** Everything this spec needs already exists:
- `Contract.score` (shipped in contracts-rewrite)
- `ContractFacility` join table (existing)
- `PendingContract` with `PendingContractStatus` enum (existing)
- `ContractTerm` + `ContractTier` (existing + enriched in contracts-rewrite)
- `COGRecord` enrichment columns (from COG data rewrite)
- `Contract.vendorId` + `Vendor.normalizedName` (from platform-data-model)

If COG data rewrite hasn't shipped when this spec executes, the live-metrics subsystem (§4.2) falls back to the older `getContract` computed-spend path that already works. No blocker.

---

## 4. Subsystems — priority-ordered

### Subsystem 0 — Action audit + merged list server action (P0)

**Priority:** P0 — foundation for the other subsystems.

**Files:**
- Create: `lib/actions/contracts.ts::getMergedContracts(facilityId, filters)` — returns system contracts + converted pending contracts, with typed `source` discriminator
- Audit: `lib/actions/contracts.ts` (878 lines) — catalog every function; flag over-long; identify duplicated logic between related actions
- Audit: `lib/actions/pending-contracts.ts` — verify status mapping used during conversion matches canonical doc §3 (`approved → active`, `submitted → pending`, etc.)

**Return shape:**

```ts
type MergedContract = {
  id: string
  contractId: string | null
  name: string
  source: "system" | "vendor"
  status: "active" | "expired" | "expiring" | "pending" | "draft" | "rejected" | "revision_requested"
  vendor: { id: string; name: string }
  contractType: ContractType
  facilityId: string | null
  facilities: string[]     // from ContractFacility join
  effectiveDate: Date
  expirationDate: Date
  totalValue: number
  score: number | null
}
```

**Acceptance:**
- `getMergedContracts` returns both system + vendor contracts in one array.
- Status values translate correctly from `PendingContractStatus` to the unified `status` enum.
- `bunx tsc --noEmit` → 0 errors.
- Audit report filed; subsystem 5 (tech debt) consumes it.

**Plan detail:** On-demand — `00-merged-action-plan.md`.

---

### Subsystem 1 — Live per-row metrics (P1)

**Priority:** P1.

**Files:**
- Create: `lib/actions/contracts.ts::getContractMetricsBatch(contractIds)` — returns `Record<contractId, { spend, rebate, totalValue }>` for a batch (one query per metric across contracts)
- Modify: `components/contracts/contracts-list-client.tsx` — fetch metrics via TanStack Query alongside contracts; render per-row
- Modify: `components/contracts/contract-columns.tsx` — add `Rebate Earned` column (right-aligned, green for positive savings sign)

**Calculation:**

```
For each contractId:
  1. Primary: aggregate COGRecord.extendedPrice WHERE contractId = X (matches enriched rows; faster post-COG-rewrite)
  2. Fallback: sum ContractPeriod.totalSpend (existing contracts-rewrite data)
  3. Final fallback: contract.currentSpend (legacy column)
  Rebate: computeRebateFromPrismaTiers(spend, firstTerm.tiers, { method })
          fallback to contract.rebateEarned if zero
  TotalValue: contract.totalValue (passthrough)
```

**Acceptance:**
- Every contract row shows a non-zero spend/rebate/totalValue when data exists.
- Vendor-submitted pending contracts show $0 spend (they have no COG history yet; expected).
- Query runs in parallel with the main contracts query; combined latency <500ms on demo scale.

**Plan detail:** On-demand — `01-live-metrics-plan.md`.

---

### Subsystem 2 — Summary stats cards (P1)

**Priority:** P1.

**Files:**
- Modify: `components/contracts/contracts-list-client.tsx` — render 3 summary cards above the table
- Modify: `lib/actions/contracts.ts::getContractStats` (existing) — verify return shape matches canonical doc §7

**Cards:**

| Card | Value | Source |
|---|---|---|
| Total Contracts | `contracts.length` | `getMergedContracts` |
| Total Contract Value | `Σ contract.totalValue` | `getContractStats.totalValue` |
| Total Rebates Earned | `Σ metrics.rebate` | `getContractMetricsBatch` aggregate |

Uses the shared `MetricCard` slot contract from dashboard-rewrite spec subsystem 1 (same uniform-height pattern) if that spec has shipped; otherwise inlines a lightweight card with the same slot structure so the dashboard spec's work later drops in cleanly.

**Acceptance:**
- Stats reflect ALL contracts (ignoring filters — canonical doc §7).
- Equal card heights at every breakpoint.

**Plan detail:** On-demand — `02-summary-stats-plan.md`.

---

### Subsystem 3 — 3-way facility filter (P1)

**Priority:** P1.

**Files:**
- Modify: `components/contracts/contract-filters.tsx` (97 lines) — audit; add facility dropdown
- Modify: `lib/actions/contracts.ts::getMergedContracts` — accept `facilityFilter` param; apply 3-way match server-side:

```ts
WHERE
  (facilityFilter == null)
  OR contract.facilityId = facilityFilter
  OR contract.contractFacilities.some(cf => cf.facilityId == facilityFilter)
```

- Modify: client facility dropdown construction — union of:
  - Active facilities from `getFacilities()`
  - Facilities referenced on any `ContractFacility` join
  - Deduped by `facilityId`

**Acceptance:**
- Filtering by "Memorial Main" narrows the list correctly across single-facility, multi-facility, and group contracts.
- Dropdown hides when there are zero facilities (fresh-tenant edge case).
- Clear filter action resets to "All".

**Plan detail:** On-demand — `03-facility-filter-plan.md`.

---

### Subsystem 4 — 5-card comparison completeness (P1)

**Priority:** P1.

**Files:**
- Modify: `components/contracts/contracts-list-client.tsx` — audit the compare tab; implement the missing cards.

**Five cards, per canonical doc §13.3:**

1. **Contract Overview** — 9 rows: Vendor, Type, Status, Effective, Expiration, Total Value, Rebates Earned, Score, Facility. Dynamic grid `repeat(N, 1fr)`.
2. **Rebate Terms** — iterates `contract.terms[].tiers[]`. Shows `Tier N — Rate X% — Threshold $Y+` with fallback chain `rebatePercent || rebateValue || 0`. Handles empty terms gracefully.
3. **Financial Performance** — Total Spend, Rebates Earned, Rebates Collected, Outstanding, Effective Rebate Rate (color-coded per canonical).
4. **Pricing Items** — Items count, Categories count, Avg Unit Price. Top 3 category badges + "N more" overflow.
5. **Contract Terms** — Duration (months), Days Remaining (color-coded), Auto Renewal, Scope. "Expiring Soon" badge when `0 < daysRemaining < 180`.

Dynamic column CSS grid: `style={{ gridTemplateColumns: "repeat(" + N + ", 1fr)" }}` where N = selected count.

**Acceptance:**
- Selecting 2-4 contracts renders all 5 cards.
- All cards handle missing data (null rebate tiers, empty pricing items, etc.) gracefully.
- Color-coding matches canonical doc.

**Plan detail:** On-demand — `04-compare-cards-plan.md`.

---

### Subsystem 5 — Mega-file splits (P1, tech debt)

**Priority:** P1 — per user's tech-debt directive.

**Files:**

**Split `components/contracts/new-contract-client.tsx` (950 lines)** into:
- `new-contract-client.tsx` — orchestrator (≤200 lines); reads URL state, routes between entry modes, owns top-level form state
- `new-contract-entry-selector.tsx` — AI/Manual/PDF tile picker (already exists per contracts-rewrite; verify)
- `new-contract-ai-flow.tsx` — AI-assisted contract creation flow
- `new-contract-manual-flow.tsx` — manual form entry (delegates to `contract-form.tsx`)
- `new-contract-pdf-flow.tsx` — PDF extraction flow (delegates to existing extractor)
- `new-contract-review.tsx` — pre-submit review step shared across all three flows

**Split `components/contracts/contract-form.tsx` (904 lines)** into:
- `contract-form.tsx` — orchestrator (≤200 lines); owns form context + `react-hook-form` setup
- `contract-form-basics.tsx` — vendor picker + contract name + type + facility scope (3-way)
- `contract-form-dates.tsx` — effective + expiration + auto-renewal
- `contract-form-terms.tsx` — wraps existing `contract-terms-entry.tsx`
- `contract-form-pricing.tsx` — wraps existing pricing item editor
- `contract-form-categories.tsx` — product categories multi-select
- `contract-form-review.tsx` — read-only summary before submit

**Audit `lib/actions/contracts.ts` (878 lines):**
- Split long functions flagged by subsystem 0 into focused helpers
- Move domain-specific helpers (`computeInsights`, `getAccrualTimeline`, `getContractMarginAnalysis`, `getContractTieInBundle`) into `lib/actions/contracts/` subdirectory
- Target: root `contracts.ts` ≤400 lines; no function ≥80 lines

**Acceptance:**
- No functional regression on `/dashboard/contracts/new`, `/dashboard/contracts/[id]/edit`, or pending-contract approval.
- Each split file has a focused responsibility.
- `bunx tsc --noEmit` → 0 errors.
- `bun run build` → compiled.

**Plan detail:** On-demand — `05-mega-file-splits-plan.md`.

---

### Subsystem 6 — UI polish (P2)

**Priority:** P2.

**Files:**
- Modify: `components/contracts/contracts-list-client.tsx` + child components.

**Polish items:**
- Empty states (no contracts + no filter matches) — informative copy, CTA to new contract
- Hydration-safe date rendering
- Responsive breakpoints: table collapses to card list on `sm`, compare cards stack on `sm`
- a11y pass: column headers, row click accessibility, dropdown keyboard navigation
- Match-status explainer hook (AI foundation feature #7) on score badge hover / row drilldown — optional on-demand

**Acceptance:**
- Manual smoke at `sm`, `md`, `lg`, `xl` viewports.
- Lighthouse a11y pass.
- Empty states render with the new copy.

**Plan detail:** On-demand — `06-ui-polish-plan.md`.

---

## 5. Execution model

**Sequencing:**

```
Subsystem 0 (action audit + merged list action)
  ↓
Subsystem 1 (live metrics)   Subsystem 3 (facility filter)
  ↓                           ↓
Subsystem 2 (summary stats)  Subsystem 4 (compare cards)
  ↓                           ↓
         Subsystem 6 (UI polish)

Subsystem 5 (mega-file splits) — runs parallel, lands any time after 0
```

**Per-subsystem cadence:** same as prior specs.

**Global verification:**
```bash
bunx tsc --noEmit
bun run lint
bun run test
bun run build
bun run db:seed
```

---

## 6. Acceptance (whole rewrite)

- All 6 subsystems merged to main.
- `/dashboard/contracts` shows merged system + pending contracts, with live per-row metrics, summary stats cards, 3-way facility filter, and 5 complete compare cards.
- `new-contract-client.tsx` and `contract-form.tsx` split; each orchestrator ≤200 lines.
- `lib/actions/contracts.ts` ≤400 lines; domain helpers moved into `lib/actions/contracts/`.
- `bunx tsc --noEmit` → 0 errors.
- `bun run test` → all passing.
- Manual smoke: list renders correctly, filters work, select 2-4 for comparison, all 5 cards render.

---

## 7. Known risks

1. **Metrics query cost at scale.** `getContractMetricsBatch` over 500+ contracts could hit DB hard. Mitigation: batch via Prisma `groupBy` in one query, not N+1. Add a LIMIT 100 default; pagination for >100.
2. **Merged list status enum overlap.** `Contract.status` and `PendingContract.status` share values but aren't identical. Mapping rules need to be explicit in subsystem 0's action + documented in the action file header.
3. **Facility filter performance on large multi-facility contracts.** Indexing on `ContractFacility.facilityId` already exists; watch for full-table scans on join queries in subsystem 3.
4. **Mega-file split regression.** 950 + 904 lines of interdependent form state. Mitigation: subsystem 5 does both splits in one coordinated commit, with manual smoke test covering new-contract + edit-contract + pending-approval flows.
5. **Compare-card data inconsistency.** Different card compute paths (per-term tier iteration vs per-row metric aggregation). Mitigation: subsystem 4's plan enumerates every data pull + the fallback chain for each card.

---

## 8. Out of scope (explicit)

- **Prototype cache globals** (`window.__cogRecordsCache`) — tydei uses TanStack Query.
- **URL-synced compare state** — local state only.
- **Bulk contract delete** — one-at-a-time via row dropdown.
- **AI-assisted compare narrative** — reserved for future AI layer spec.
- **Admin portal contracts list** — separate concern in admin spec (future).
- **Vendor-portal contracts list** — separate spec.

---

## 9. How to iterate

1. Pick a subsystem (start with 0).
2. Generate per-subsystem plan via superpowers:writing-plans.
3. Execute; commit each separately.
4. Verify; merge; proceed.
