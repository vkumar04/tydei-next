# Contracts Actions Audit — 2026-04-18

**Scope:** `lib/actions/contracts.ts` (878 → 1014 L after subsystem 0) + `lib/actions/pending-contracts.ts` (172 L).

**Purpose:** Establish the function catalog and split target for contracts-list-closure subsystem 5 (tech debt), plus verify PendingContract → Contract status mapping.

---

## 1. `lib/actions/contracts.ts`

### Function catalog (post subsystem 0)

| # | Function | Start | Lines | Category | Notes |
|---|---|---|---|---|---|
| 1 | `getContracts(input)` | 49 | 61 | List | Filtered + paginated list; derives aggregated rebateEarned/rebateCollected |
| 2 | `getMergedContracts()` | **109** | **136** | **List (new)** | **NEW in subsystem 0** — merges system + vendor-submitted contracts |
| 3 | `getContract(id)` | 245 | 75 | Read | Full detail with terms/tiers/docs/facilities/categories |
| 4 | `getContractStats()` | 324 | 32 | Read | Summary stats — ignores filters |
| 5 | `createContract(input)` | 356 | 63 | Write | Creates + logs audit + recomputes COG match-statuses |
| 6 | `updateContract(id, input)` | 419 | 99 | Write | Update + recompute for OLD and NEW vendor (if changed) |
| 7 | `createContractDocument(input)` | 518 | 19 | Write | |
| 8 | `deleteContractDocument(id)` | 537 | 38 | Write | |
| 9 | `deleteContract(id)` | 575 | 42 | Write | Delete + recompute to flip rows off |
| 10 | `getContractInsights(contractId)` | 617 | 133 | Compute | Compliance + market-share + price-variance for detail page |
| 11 | `getAccrualTimeline(contractId)` | 750 | 79 | Compute | Monthly accrual schedule |
| 12 | `getContractMarginAnalysis(contractId)` | 829 | 134 | Compute | True-margin analysis for case-costing surface |
| 13 | `getContractTieInBundle(contractId)` | 963 | 51 | Compute | Tie-in bundle summary |

**Helpers (non-exported):**
- `mapPendingStatus(status)` — new in subsystem 0; translates `PendingContractStatus` → unified list status

### Findings

- **File size:** 1014 L after subsystem 0. Still under the 1500 L "critical" threshold but warrants the subsystem 5 split.
- **Largest functions:** `getContractMarginAnalysis` (134 L), `getContractInsights` (133 L). Both are compute-heavy per-detail-page actions. Good split candidates:
  - `lib/actions/contracts/read.ts` — getContracts, getMergedContracts, getContract, getContractStats (~250 L)
  - `lib/actions/contracts/write.ts` — create/update/delete + document CRUD (~260 L)
  - `lib/actions/contracts/insights.ts` — getContractInsights, getAccrualTimeline (~215 L)
  - `lib/actions/contracts/margin.ts` — getContractMarginAnalysis (~135 L)
  - `lib/actions/contracts/tie-in.ts` — getContractTieInBundle (~55 L)
  - `lib/actions/contracts.ts` — re-export facade (~15 L)
- **Duplicated ownership check:** every write action re-runs the
  `findUniqueOrThrow` with the `facilityId OR contractFacilities some` scope check. Extract to `assertContractOwnership(id, facilityId)` helper.
- **Recompute calls centralized:** subsystem 2 introduced exactly 3 sites for `recomputeMatchStatusesForVendor` — create/update/delete. No other action calls it. This is the correct surface.
- **Missing column:** `Contract.score` is referenced in contracts-list-closure spec §4.4 but does not exist on the current schema. The merged-list action returns `score: null` as a forward-compatible placeholder. Adding the column is a contracts-rewrite follow-up (not a list-closure task).

### Split target

Same as above; 6 files ≈ 1030 L replacing 1 file at 1014 L. Net +16 L (import overhead). Worth it for per-domain locality.

---

## 2. `lib/actions/pending-contracts.ts` (172 L)

### Function catalog

| # | Function | Start | Lines | Audience | Notes |
|---|---|---|---|---|---|
| 1 | `getVendorPendingContracts(vendorId?)` | 15 | 10 | Vendor | List own submissions |
| 2 | `getVendorPendingContract(id)` | 28 | 9 | Vendor | Single submission |
| 3 | `createPendingContract(input)` | 40 | 24 | Vendor | Submit to facility |
| 4 | `updatePendingContract(id, input)` | 67 | 20 | Vendor | Edit draft/revision |
| 5 | `withdrawPendingContract(id)` | 90 | 8 | Vendor | Cancel submission |
| 6 | `getFacilityPendingContracts(facilityId?)` | 101 | 10 | Facility | List inbox (submitted only) |
| 7 | `approvePendingContract(id, reviewedBy)` | 114 | 27 | Facility | **Promote to Contract** |
| 8 | `rejectPendingContract(id, reviewedBy, notes)` | 144 | 13 | Facility | Mark rejected |
| 9 | `requestRevision(id, reviewedBy, notes)` | 160 | 13 | Facility | Mark revision_requested |

### Status mapping verification

| PendingContractStatus | Mapped (via mapPendingStatus) | Appears in merged list? |
|---|---|---|
| `draft` | `draft` | ✅ yes (filtered to in: [submitted, revision_requested, rejected, draft]) |
| `submitted` | `pending` | ✅ yes |
| `approved` | `active` (defensive; normally filtered away) | ⚠️ edge — approved pending contracts have already been promoted to a system Contract row via `approvePendingContract`, and the PendingContract.status field becomes `approved` for audit trail. The merged-list action filters these OUT via the `status in [...]` whitelist, so they don't double-render. If a race produces a momentary `approved` row before the Contract insert commits, it would map to `active` — this is correct degenerate behavior. |
| `rejected` | `rejected` | ✅ yes |
| `revision_requested` | `revision_requested` | ✅ yes |
| `withdrawn` | `null` (hidden) | ❌ no — helper returns null, filter drops |

**Conclusion:** Status mapping is correct and defensive. The spec's requirement (`approved → active`, `submitted → pending`, etc.) is honored.

### Findings

- **`approvePendingContract` does NOT call `recomputeMatchStatusesForVendor`.** This is a gap — when a pending contract becomes a real Contract, COG rows for that vendor should flip to `on_contract` / `price_variance`. Tracked as a follow-up task (not subsystem 0 scope).
- **`approvePendingContract` doesn't port `contractFacilities` or `pricingItems`** from the pending submission. The promoted Contract has only `vendorId` + `facilityId` + dates + totalValue. Pricing data lives in `pending.pricingData` (JSON) but isn't unpacked. Another follow-up.

### No split needed

172 L — well under threshold. Keep as-is.

---

## 3. Recommendation for subsystem 5 (tech debt)

Execute in this order:

1. **Extract `assertContractOwnership` helper** — 6 call sites, one PR.
2. **Split `lib/actions/contracts.ts` into `lib/actions/contracts/*.ts`** — 6 files, mechanical.
3. **Backfill `approvePendingContract` to call recompute + port pricingData** — behavior change, own PR.

Files **not** to split:
- `pending-contracts.ts` (172 L) — small, cohesive.

---

## 4. Follow-up tasks discovered

| # | Task | Scope | Parent |
|---|---|---|---|
| F1 | Add `Contract.score` column + compute subsystem | Schema + compute | contracts-rewrite follow-up |
| F2 | Wire `approvePendingContract` → `recomputeMatchStatusesForVendor` | Backfill | cog-data-rewrite follow-up |
| F3 | Backfill `approvePendingContract` to port pricingData into ContractPricing rows | Data migration | pending-contracts follow-up |
| F4 | Extract `assertContractOwnership(id, facilityId)` helper | Refactor | contracts-list-closure subsystem 5 |
| F5 | Split `lib/actions/contracts.ts` into per-domain files | Refactor | contracts-list-closure subsystem 5 |
