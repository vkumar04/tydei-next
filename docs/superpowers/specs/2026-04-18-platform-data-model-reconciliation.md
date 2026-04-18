# Platform Data-Model Reconciliation — Design Spec

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement the subsystems below. Each subsystem gets its own per-subsystem TDD plan generated on demand. Steps in those plans use checkbox (`- [ ]`) syntax for tracking.

**Date:** 2026-04-18
**Branch:** continue in `contracts-rewrite-00-schema`
**Status:** Design approved by Vick (2026-04-18)
**Related specs:**
- Shipped: `2026-04-18-contracts-rewrite.md` (engines referenced from §5.2)
- Parked: `2026-04-18-facility-dashboard-rewrite.md`, `2026-04-18-renewals-rewrite.md`
- Foundation: `2026-04-18-ai-integration-foundation.md` (AI dedup features plug in here)
- Coming next: `cog-data-rewrite` (depends on this) → `contracts-list-closure` (depends on this) → `data-pipeline-rewrite` (depends on this)

**Goal:** Lock in the canonical rules for how **vendors, facilities, contracts, and COG records join**, dedupe, merge, and cascade across the platform. Single source of truth for:
- Vendor name normalization + alias map
- Vendor division hierarchy + inference
- Facility identity model (collapse dual-store to single-store)
- GPO contract auto-propagation to member facilities
- Contract duplicate prevention at create time
- Vendor/facility merge operations with full audit
- The canonical `matchCOGRecordToContract` algorithm with 6 status values
- Rebate split across facilities on multi-facility contracts

**Architecture:** Pure functions + a small handful of additive schema changes. No radical re-architecture — tydei's existing Prisma models (`Vendor`, `Facility`, `HealthSystem`, `Contract`, `ContractFacility`, `COGRecord`) already support most of this; this spec locks in the rules on top of them. The only new primitives are a typed alias-map constant, a division-inference helper, a merge-operation audit log, and a `matchStatus` column on `COGRecord`.

**Tech Stack (unchanged):** Next.js 16, Prisma 7, Better Auth, TanStack Query, Zod. Reuses `AuditLog` from the existing schema for merge operations.

---

## 1. Scope

### In scope

- **Vendor resolution rules** (normalization + alias map + division inference). Live as code + constants, not Prisma data.
- **Facility model clarification** — tydei has `Facility` + `HealthSystem` already. This spec explicitly documents "we use one store, not two." No schema change.
- **Multi-facility + GPO scoping** for contracts (auto-propagation on facility join, rebate split by spend share).
- **Canonical COG→contract matching** — the 6-status algorithm, persisted as a new `matchStatus` column on `COGRecord`.
- **Contract duplicate prevention** at create time.
- **Vendor and facility merge operations** with admin UI + audit log. Not auto; admin-initiated.
- **Reconciliation jobs (on-demand only).** Re-match all COG rows when contracts change. No cron for v1.
- **Cross-spec primitives** — exports consumed by COG / contracts-list / data-pipeline specs.

### Out of scope

- **Nightly cron-based reconciliation.** V1 is on-demand + event-driven (synchronous in the mutating user's session, same pattern as contracts-rewrite's accrual recompute).
- **Automatic vendor/facility merge.** Admin-only. No ML-driven dedup across the entire vendor registry.
- **"Unknown" bucket for unreconciled COG rows.** A `matchStatus = 'unknown_vendor'` value handles this — no separate bucket.
- **Legacy-data backfill** beyond what's needed for the migration. This spec ships the columns + logic; backfilling the entire historic COG table is a one-off ops script documented in subsystem 0.
- **Fuzzy matching at query time.** All fuzzy logic runs at import / merge time. Queries use typed FKs + exact match.

### Non-goals (preserved)

- No stack swaps. No debug-route ports.
- No breaking changes to existing pages — every existing query continues to work.

---

## 2. Translation notes — prototype → tydei

The canonical cross-cutting doc was written for the prototype (dual stores, string-matching everywhere, in-memory alias map via `findCanonicalVendor`). Translate before copying:

| Prototype pattern | Tydei equivalent |
|---|---|
| Dual `vendor-store` + `vendor-identity-store` | Single `Vendor` Prisma table + session's user → role → org hierarchy. Resolution logic lives in a helper, not a separate store. |
| Dual `facilities-store` + `facility-identity-store` | Single `Facility` Prisma table + `HealthSystem`. Accessible-facilities derived from user's role/permissions. |
| `normalizeVendorName()` as a prototype utility | Ported verbatim to `lib/vendors/normalize.ts`. Pure function. |
| Hardcoded `vendorAliases: Record<string, string[]>` constant | Ported to `lib/vendors/alias-map.ts` as a typed `const`. Not a Prisma table — changes require a code deploy. |
| Division inference via regex | Two layers: (1) `lib/vendors/infer-division.ts` rules-first, (2) Claude fallback via AI foundation spec when rules return null. |
| `dispatchEvent('contractFacilityAdded')` | `queryClient.invalidateQueries({ queryKey: queryKeys.contracts.* })` on GPO propagation. |
| In-memory merge of vendor records | `mergeVendors(keepId, removeId)` Prisma transaction in `lib/vendors/merge.ts`. Reassigns FKs, writes AuditLog, deletes the removed vendor. Admin-only server action. |
| `matchCOGRecordToContract` returns status string | Same 6-status enum, but persisted as `COGRecord.matchStatus` column (additive). Recomputed on contract CRUD. |
| `resolveGPOContractFacilities` cascade from parent system | Prisma query: `facilitiesByHealthSystem(healthSystemId)` join. GPO contract's `facilities[]` is kept explicit for audit, auto-updated when a facility joins via subsystem 5. |

---

## 3. Data model changes

All additive. One `bun run db:push` + `prisma generate` pass during subsystem 0.

### 3.1 `COGRecord.matchStatus` column

```prisma
enum COGMatchStatus {
  pending                 // not yet enriched
  on_contract             // vendor + item + scope + date all match
  off_contract_item       // vendor matches, item not on any contract
  out_of_scope            // vendor + item match, wrong facility or date
  unknown_vendor          // no vendor match at all
  price_variance          // on contract, but actual price differs from contract price
}

model COGRecord {
  // ... existing fields from contracts-rewrite migration:
  //     contractId, contractPrice, isOnContract, savingsAmount, variancePercent
  //     (all 5 added in COG data spec — see out-of-scope note below)

  matchStatus COGMatchStatus @default(pending)
}
```

> **Note on the 5 enrichment columns from COG spec.** Those ship in the COG rewrite spec's subsystem 0. This spec only adds `matchStatus`. If COG spec hasn't shipped yet when this spec executes, `matchStatus` still lands standalone — the enrichment columns are independent.

Index:
```prisma
@@index([matchStatus])
@@index([facilityId, matchStatus])
```

Supports fast filtering of "how many off-contract records does this facility have?" without a full table scan.

### 3.2 `VendorMergeAudit` model (optional; fold into existing AuditLog)

Existing `AuditLog` already handles merge audit via `entityType + metadata`. No new model. Conventions:

```ts
await logAudit({
  userId: session.user.id,
  action: "vendor.merged",
  entityType: "vendor",
  entityId: keepId,
  metadata: {
    mergedFrom: removedId,
    removedName: "Stryker Corp",
    keepName: "Stryker",
    affectedContracts: N,
    affectedCogRecords: M,
    timestamp: new Date().toISOString(),
  },
})
```

Same pattern for `facility.merged`. Zero schema additions.

### 3.3 No other model changes

`HealthSystem.parentSystemId`, `Facility.healthSystemId`, `Vendor.parentVendorId`, `ContractFacility` junction — **all already exist** in tydei's schema. The rules in this spec operate over the existing shape.

---

## 4. The canonical rules (reference material)

This section is the contract between this spec and every consumer spec. Each subspec cites §4.X.

### 4.1 Vendor name normalization

```ts
// lib/vendors/normalize.ts
export function normalizeVendorName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .replace(
      /\s*(inc|corp|corporation|llc|ltd|limited|holdings|medical|surgical|global)\.?$/i,
      "",
    )
    .trim()
}
```

Pure function. Never mutates. Every CSV import, contract creation, and lookup call goes through this.

### 4.2 Vendor alias map

```ts
// lib/vendors/alias-map.ts
export const VENDOR_ALIASES: Record<string, string[]> = {
  "stryker":        ["stryker", "stryker corporation", "stryker orthopaedics"],
  "arthrex":        ["arthrex", "arthrex inc"],
  "zimmer biomet":  ["zimmer biomet", "zimmer", "biomet"],
  "depuy synthes":  ["depuy synthes", "depuy", "synthes"],
  "smith nephew":   ["smith nephew", "smith and nephew"],
  "medtronic":      ["medtronic", "medtronic plc"],
  // ... extend as needed, via code deploy
}

export function findCanonicalVendor(rawName: string): string | null {
  const normalized = normalizeVendorName(rawName)
  for (const [canonical, aliases] of Object.entries(VENDOR_ALIASES)) {
    if (aliases.some(a => normalizeVendorName(a) === normalized)) return canonical
  }
  return null
}
```

The alias map is a code constant. Changes require a PR + code review. Rationale: this is business-critical normalization logic; a typo in the map corrupts every downstream match.

### 4.3 Vendor resolution cascade

```
findVendorByName(rawName):
  1. normalized = normalizeVendorName(rawName)
  2. exact match in Prisma: Vendor where normalizedName = normalized → return
  3. canonical = findCanonicalVendor(rawName)
  4. if canonical: match on Prisma Vendor where normalizedName = canonical → return
  5. (Claude fuzzy fallback, if subsystem 2 + AI foundation both ready) →
     suggest similar existing vendors via `vendor_dedup` AI feature
  6. null (caller may prompt admin to create via review UI)
```

**Schema note:** Every `Vendor` row has a denormalized `normalizedName` column. Populated by trigger (or by application code — picking application code for v1; simpler). Indexed.

### 4.4 Division inference

```ts
// lib/vendors/infer-division.ts
export function inferDivisionFromItem(
  description: string,
  category?: string,
  vendorName?: string,
): string | null {
  const desc = (description + " " + (category ?? "")).toLowerCase()
  if (/\b(knee|hip|shoulder|femoral|tibial)\b/.test(desc))   return "orthopaedics"
  if (/\b(pedicle|spine|vertebra|interbody|cage)\b/.test(desc)) return "spine"
  if (/\b(endoscope|camera|light source|arthroscop)\b/.test(desc)) return "endoscopy"
  if (/\b(drill|saw|reamer|power)\b/.test(desc)) return "instruments"
  return null
}
```

Rule-based first. Claude fallback (AI foundation feature #5) called only when rules return null AND the vendor has multiple active divisions. Otherwise default to parent vendor.

### 4.5 Facility model

Tydei uses a single `Facility` table with `healthSystemId` nullable FK. No dual-store problem.

**Accessible facilities cascade** (derived, not stored):

```
getAccessibleFacilities(userId):
  1. user = load User with facilityAssignments + healthSystemAssignments
  2. facilities = []
  3. for each facility in user.facilityAssignments: facilities.push
  4. for each system in user.healthSystemAssignments:
        for each facility in healthSystem.facilities: facilities.push (dedup)
  5. if user.role === "system_admin": facilities = all active facilities
  6. return facilities
```

Helper lives in `lib/facilities/accessible.ts`.

### 4.6 GPO contract scoping

```ts
// lib/contracts/scope.ts
export function resolveContractFacilities(contract: Contract): string[] {
  if (contract.isMultiFacility && contract.contractFacilities?.length) {
    return contract.contractFacilities.map(cf => cf.facilityId)
  }
  if (contract.facilityId) return [contract.facilityId]
  // GPO special case: contract is at health-system level
  if (contract.healthSystemId) {
    return prismaCachedFacilitiesForSystem(contract.healthSystemId)
  }
  return []
}
```

### 4.7 GPO auto-propagation

When `Facility.healthSystemId` is set (facility joins a system), a Prisma hook re-reads all active contracts with `healthSystemId` matching and appends a `ContractFacility` row for the new facility.

Implementation: not actually a Prisma hook (no native support). Lives in `lib/facilities/on-assign.ts`. Called from `assignFacilityToHealthSystem` server action.

### 4.8 Rebate split by spend share (multi-facility)

For any multi-facility contract, total rebate is calculated on **aggregated spend across all scoped facilities**, then split proportionally.

```ts
// lib/contracts/rebate-split.ts
export function splitRebateByFacility(
  contract: Contract,
  totalRebate: number,
  spendByFacility: Record<string, number>,
): Record<string, number> {
  const totalSpend = Object.values(spendByFacility).reduce((a, b) => a + b, 0)
  if (totalSpend <= 0) return {}
  const result: Record<string, number> = {}
  for (const [facilityId, spend] of Object.entries(spendByFacility)) {
    result[facilityId] = totalRebate * (spend / totalSpend)
  }
  return result
}
```

Consumed by: renewals spec's performance view, dashboard rewrite's facility-level rebate breakdown (when it ships), contracts-rewrite subsystem 3's accrual (extend to per-facility split if contract is multi-facility — small follow-up in this spec's subsystem 6).

### 4.9 Canonical `matchCOGRecordToContract` algorithm

Ports the appendix function from the cross-cutting doc verbatim, with tydei type names. Lives in `lib/contracts/match.ts`. Called from the COG enrichment pipeline (COG spec) and anywhere a COG row needs a fresh `matchStatus`.

```
matchCOGRecordToContract(record, contracts):
  vendor = findVendorByName(record.vendorName) → if null, return { status: "unknown_vendor" }
  activeContracts = contracts.filter(c => c.vendorId === vendor.id && c.status in [active, expiring])
  if !activeContracts.length: return { status: "off_contract_item", reason: "no active contract for vendor" }

  inScope = activeContracts.filter(c => resolveContractFacilities(c).includes(record.facilityId))
  if !inScope.length: return { status: "out_of_scope", reason: "no contract covers this facility" }

  byDate = inScope.filter(c => record.transactionDate in [c.effectiveDate, c.expirationDate])
  if !byDate.length: return { status: "out_of_scope", reason: "no contract covers this date" }

  for contract in byDate:
    item = contract.pricingItems.find(p => p.vendorItemNo.toLowerCase() === record.vendorItemNo?.toLowerCase())
    if !item: continue

    variancePct = ((record.unitCost - item.unitPrice) / item.unitPrice) × 100
    if |variancePct| > PRICE_VARIANCE_THRESHOLD (2%):
      return { status: "price_variance", contractId: contract.id, contractPrice: item.unitPrice, variancePercent: variancePct }
    return { status: "on_contract", contractId: contract.id, contractPrice: item.unitPrice, savings: (item.listPrice - item.unitPrice) × record.quantity }

  return { status: "off_contract_item", reason: "vendor and facility and date match, but item not on any contract" }
```

Pure function over pre-loaded data. The loader is the server action that calls it (typical: `recomputeMatchStatusesForFacility`).

### 4.10 Contract duplicate prevention

```ts
// lib/contracts/duplicate-check.ts
export function isContractDuplicate(
  input: NewContractInput,
  existing: Contract[],
): { isDuplicate: boolean; conflictId?: string; reason?: string } {
  const candidates = existing.filter(c =>
    c.vendorId === input.vendorId &&
    c.contractType === input.contractType &&
    c.status === "active" &&
    datesOverlap(c.effectiveDate, c.expirationDate, input.effectiveDate, input.expirationDate) &&
    facilitiesOverlap(resolveContractFacilities(c), input.facilityIds),
  )
  if (candidates.length === 0) return { isDuplicate: false }
  return { isDuplicate: true, conflictId: candidates[0].id, reason: "overlapping active contract for same vendor+type+facility+dates" }
}
```

Called from `createContract` action. If `isDuplicate`, the action returns a typed error that the UI surfaces as "An overlapping contract exists. [View existing]".

### 4.11 Canonical sign convention

**Locking in:** `savings` is positive when the facility paid *less* than list. `variance` is signed from the perspective of "what we paid above contract":
- `variancePercent > 0` → facility overpaid (bad). Alert.
- `variancePercent < 0` → facility underpaid (rare; probably a credit-memo correction).
- `variancePercent === 0` → on contract.

This is the opposite of the cross-cutting doc's appendix (which says `savings = -variance`). We pick the **intuitive** convention: positive savings = win.

Every `lib/contracts/*`, `lib/cog/*`, and `lib/invoices/*` function must document this convention inline. Subsystem 0's audit enforces it.

### 4.12 Severity unification

Unify the cross-cutting doc's `PRICE_VARIANCE` threshold (2%) with the contracts-rewrite subsystem 5 severity levels (minor <2%, moderate 2–10%, major ≥10%):

- **Match-status** (`COGRecord.matchStatus`): flags `price_variance` when `|variancePercent| ≥ 2%`.
- **Severity** (`InvoicePriceVariance.severity` from contracts-rewrite subsystem 5): minor `<2%`, moderate `2–10%`, major `≥10%`.

Three levels, not six (the COG canonical spec's §7 `SavingsClassification` enum has 6; we drop it in favor of the 3-level severity). One vocabulary across the platform.

---

## 5. Subsystems — priority-ordered

### Subsystem 0 — Schema migration + audit (P0)

**Priority:** P0 — blocks every feature below.

**Files:**
- Modify: `prisma/schema.prisma` — add `COGMatchStatus` enum + `COGRecord.matchStatus` column + indexes
- Modify: `prisma/seed.ts` — no new seed data; re-match on seeded COG rows via subsystem 5 logic
- Audit: all files that touch `COGRecord` for sign-convention violations (§4.11). List is short: `lib/actions/cog-records.ts`, `lib/cog/enrichment.ts` (post-COG-spec), `lib/actions/dashboard.ts`.

**Acceptance:**
- `bunx prisma validate` → valid.
- `bun run db:push` → in sync, zero data-loss warnings.
- `bunx prisma generate` → zod types regenerated.
- `bunx tsc --noEmit` → 0 errors.
- Every seeded COG row initially has `matchStatus = 'pending'` (safe default; subsystem 5 backfills).
- Sign-convention audit report filed in subsystem 0's plan.

**Plan detail:** On-demand — `00-schema-plan.md`.

---

### Subsystem 1 — Vendor normalization + alias + resolution (P0)

**Priority:** P0 — foundational.

**Files:**
- Create: `lib/vendors/normalize.ts` — `normalizeVendorName`
- Create: `lib/vendors/alias-map.ts` — `VENDOR_ALIASES` constant + `findCanonicalVendor`
- Create: `lib/vendors/resolve.ts` — `findVendorByName(rawName)` cascade
- Create: `lib/vendors/__tests__/normalize.test.ts` + `resolve.test.ts`
- Modify: `prisma/schema.prisma` — add `Vendor.normalizedName String` column (unique)
- Modify: existing vendor CRUD paths to maintain `normalizedName` on create/update

**Acceptance:**
- `normalizeVendorName("Stryker Corp.")` === `"stryker"`. 20+ unit tests covering edge cases.
- `findVendorByName` cascade hits exact → canonical → null in correct order. No DB call when deterministic resolution suffices.
- `Vendor.normalizedName` populated for every existing seeded row via migration step.
- Claude fallback hook defined but unused (plugs in later from COG spec's vendor-dedup feature).

**Plan detail:** On-demand — `01-vendor-resolution-plan.md`.

---

### Subsystem 2 — Division hierarchy + inference (P1)

**Priority:** P1.

**Files:**
- Create: `lib/vendors/infer-division.ts` — rule-based inference per §4.4
- Create: `lib/vendors/__tests__/infer-division.test.ts`
- Create: `lib/vendors/rollup.ts` — `aggregateByParentVendor(records)` for reports
- Verify: `Vendor.parentVendorId` FK exists and is indexed
- Verify: `VendorDivision` model exists (seen earlier) — this spec uses `parentVendorId` on `Vendor`, not a separate division table, unless tests reveal otherwise

**Acceptance:**
- `inferDivisionFromItem("knee implant tray", "ORTHO")` returns `"orthopaedics"`.
- Rollup function aggregates division spend up to parent correctly.
- Claude fallback hook defined (consumed by COG spec).

**Plan detail:** On-demand — `02-division-plan.md`.

---

### Subsystem 3 — GPO scoping + auto-propagation (P1)

**Priority:** P1.

**Files:**
- Create: `lib/contracts/scope.ts` — `resolveContractFacilities(contract)` per §4.6
- Create: `lib/facilities/on-assign.ts` — `onFacilityAssignedToSystem(facilityId, systemId)`; finds active GPO contracts and extends `ContractFacility` join rows
- Modify: `lib/actions/admin/facilities.ts` — call `onFacilityAssignedToSystem` when admin assigns or moves a facility
- Modify: existing `Contract` queries that resolve scope — centralize through `resolveContractFacilities`

**Acceptance:**
- `resolveContractFacilities` correctly returns scope for: single-facility, multi-facility, GPO-at-system.
- Assigning a new facility to a health system auto-extends any GPO contract's `ContractFacility` rows + invalidates relevant TanStack queries.
- Integration test: create GPO contract at health-system-A → add facility F1 mid-contract → F1 appears in `resolveContractFacilities(contract)` → F1's COG records match the GPO contract after recompute.

**Plan detail:** On-demand — `03-gpo-scoping-plan.md`.

---

### Subsystem 4 — Rebate split by facility (P1)

**Priority:** P1.

**Files:**
- Create: `lib/contracts/rebate-split.ts` — `splitRebateByFacility` per §4.8
- Create: `lib/contracts/__tests__/rebate-split.test.ts`
- Modify: `lib/contracts/accrual.ts` (from contracts-rewrite subsystem 3) — extend `buildMonthlyAccruals` to support per-facility spend breakdown when contract is multi-facility. The top-level accrual number stays total; the new breakdown is an optional additional field on the return type.
- Modify: consumer pages (renewals, dashboard — when they ship) to render the split

**Acceptance:**
- Memorial Health System with 3 facilities at 50/30/20 spend share: total rebate $40K → splits to $20K / $12K / $8K.
- Single-facility contracts unchanged (function returns `{ [only-facility]: total }`).
- Zero spend at a facility → zero rebate allocation (no division-by-zero).

**Plan detail:** On-demand — `04-rebate-split-plan.md`.

---

### Subsystem 5 — Canonical match algorithm + recompute (P0)

**Priority:** P0 — blocks COG rewrite and data pipeline rewrite.

**Files:**
- Create: `lib/contracts/match.ts` — `matchCOGRecordToContract` per §4.9
- Create: `lib/contracts/__tests__/match.test.ts` — one test per of the 6 statuses plus edge cases
- Create: `lib/actions/recompute-matches.ts` — server actions:
  - `recomputeMatchStatusesForFacility(facilityId)`
  - `recomputeMatchStatusesForVendor(vendorId)` — narrower scope for contract-save hook
  - `recomputeMatchStatusesForContract(contractId)`
- Modify: `lib/actions/contracts.ts` — call `recomputeMatchStatusesForVendor` on contract create / update / status-change. Same call site as contracts-rewrite's accrual recompute; similar pattern (inline, user-session scoped).

**Acceptance:**
- All 6 status values produced correctly for seeded data across the 6 distinct cases.
- Contract create → matching COG rows move from `off_contract_item` / `unknown_vendor` to `on_contract`.
- Contract expiration date update → affected rows re-evaluate.
- Facility join to GPO system → affected contracts' matching rows re-evaluate.
- Idempotent: running recompute twice gives the same result.

**Plan detail:** On-demand — `05-match-recompute-plan.md`.

---

### Subsystem 6 — Contract duplicate prevention (P1)

**Priority:** P1.

**Files:**
- Create: `lib/contracts/duplicate-check.ts` — `isContractDuplicate` per §4.10
- Create: `lib/contracts/__tests__/duplicate-check.test.ts`
- Modify: `lib/actions/contracts.ts::createContract` — run `isContractDuplicate` pre-create; return typed error when duplicate
- Modify: `lib/actions/pending-contracts.ts::createPending` — same check against existing active contracts + existing pending submissions
- Modify: contract-create form UI — surface duplicate error with link to conflicting contract

**Acceptance:**
- Creating an active Stryker USAGE contract for Memorial Main covering 2026-01-01 → 2026-12-31, then attempting another Stryker USAGE contract for Memorial Main covering 2026-06-01 → 2027-05-31 → rejected with typed error.
- Creating a same-vendor CAPITAL contract covering same period → allowed (different type).
- Creating a same-vendor USAGE contract covering different facility → allowed.
- Pending submission for an already-active scope → rejected.

**Plan detail:** On-demand — `06-duplicate-prevention-plan.md`.

---

### Subsystem 7 — Vendor + facility merge admin tools (P2)

**Priority:** P2 — nice to ship, but not blocking.

**Files:**
- Create: `lib/vendors/merge.ts` — `mergeVendors(keepId, removeId)` transaction; reassigns `Contract.vendorId` + `COGRecord.vendorId` + any `PendingContract.vendorId`; writes AuditLog; deletes removed vendor.
- Create: `lib/facilities/merge.ts` — `mergeFacilities(keepId, removeId)` similar.
- Create: `components/admin/merge/vendor-merge-dialog.tsx` — admin-only modal; two vendor pickers + preview of affected-record counts + confirm.
- Create: `components/admin/merge/facility-merge-dialog.tsx`.
- Modify: `app/admin/vendors/page.tsx` — add "Merge vendors" admin action.
- Modify: `app/admin/facilities/page.tsx` — add "Merge facilities" admin action.

**Acceptance:**
- Admin UI shows "This will reassign N contracts and M COG records. Continue?" before commit.
- Transaction atomic: if any step fails, no changes persist.
- AuditLog row written with full before/after snapshot.
- Merge triggers `recomputeMatchStatusesForVendor` / per-facility.
- Non-admin roles can't access (RBAC via `requireAdmin`).

**Plan detail:** On-demand — `07-merge-admin-plan.md`.

---

### Subsystem 8 — Canonical key reference doc + DX polish (P2)

**Priority:** P2 — documentation.

**Files:**
- Create: `docs/architecture/canonical-keys.md` — cross-store key map (from cross-cutting canonical doc §16)
- Create: `docs/architecture/matching-order.md` — the 6-step priority cascade
- Modify: `CLAUDE.md` — add a pointer to this spec + the canonical-keys doc so future sessions know where to find the rules

**Acceptance:**
- Docs are up to date with code (verified by a test that imports each listed function).
- `CLAUDE.md` points to the canonical docs.
- No dead links.

**Plan detail:** On-demand — `08-docs-polish-plan.md`.

---

## 6. Execution model

**Sequencing:**

```
Subsystem 0 (schema + sign convention audit)
  ↓
Subsystem 1 (vendor resolution)
  ↓                         ↘
Subsystem 2 (division)     Subsystem 3 (GPO scope)    Subsystem 4 (rebate split)
  ↓                         ↓                          ↓
            Subsystem 5 (match algorithm + recompute)
                        ↓                ↘
            Subsystem 6 (dup prevention)  Subsystem 7 (merge admin)
                                                  ↓
                    Subsystem 8 (docs polish)
```

Subsystems 2-4 parallelize after 1. Subsystem 5 depends on 1+3. Subsystems 6-7 depend on 5. Subsystem 8 is last.

**Per-subsystem cadence:** same as prior specs.

**Global verification (after each subsystem):**

```bash
bunx tsc --noEmit
bun run lint
bun run test
bun run build
bun run db:seed
```

Plus:
```bash
bun run test lib/contracts/__tests__/match.test.ts        # canonical matcher
bun run test lib/vendors/__tests__/resolve.test.ts        # resolution cascade
bun run test lib/contracts/__tests__/rebate-split.test.ts # split math
```

---

## 7. Acceptance (whole rewrite)

- All 8 subsystems merged to main.
- `COGRecord.matchStatus` populated for every seeded row after subsystem 5 backfill.
- Every vendor name lookup across the platform flows through `findVendorByName`.
- Every contract scope resolution flows through `resolveContractFacilities`.
- Every rebate split in multi-facility contracts flows through `splitRebateByFacility`.
- Every contract create blocks overlapping duplicates.
- Admin merge tools work end-to-end; AuditLog populated.
- `bunx tsc --noEmit` → 0 errors.
- `bun run test` → all passing.
- `bun run db:seed` → 10/10 QA sanity + new QA checks asserting match-status distribution.

---

## 8. Known risks

1. **Normalized-name column drift.** If any CRUD path forgets to update `Vendor.normalizedName`, lookups silently miss. Mitigation: a pre-commit test that every Prisma `vendor.create|update` call goes through a wrapper that maintains the column.
2. **Alias map as code constant is rigid.** Adding a new alias requires a PR. Accepts this trade-off: these are load-bearing business rules that deserve code review. Emergency additions can be done via hotfix.
3. **Recompute storm on large contracts.** Assigning a facility to a health system with 10 active GPO contracts × 10k COG rows per contract = 100k writes. Mitigation: `recomputeMatchStatusesForContract` is scoped to the contract's vendor's records only; acceptable at demo scale. Background-job extraction is a TODO.
4. **Merge reversibility.** Vendor merge reassigns FKs and deletes the removed vendor row — irreversible without a restore from backup. Mitigation: admin merge UI shows "This cannot be undone. Confirm with exact vendor name." + AuditLog before/after snapshot allows manual reconstruction.
5. **Sign convention audit may surface existing bugs.** Some existing code may use the wrong sign. Subsystem 0 surfaces a list; each bug becomes a ticket, not a spec expansion.
6. **GPO auto-propagation UX surprise.** Admin assigns a facility → contract scope expands silently. Mitigation: `onFacilityAssignedToSystem` returns the list of contracts it modified; admin UI shows "This facility will be added to 3 active GPO contracts. Continue?"

---

## 9. Out of scope (explicit)

- **Fuzzy matching in production queries.** All fuzzy work is at import / merge time only.
- **Nightly reconciliation cron.** V1 is on-demand + event-driven.
- **Automatic vendor / facility merge (ML-driven).** Admin-initiated only.
- **Multi-tenant alias maps** (per-org customization). Single global map.
- **GPO rebate cash-distribution.** Spec §4.8 splits the numbers; actual payout to facilities is a billing / Stripe concern out of this spec.
- **Migration of legacy COG rows.** Backfill happens in subsystem 5's recompute; no migration beyond the `matchStatus` default.

---

## 10. How to iterate

1. Pick a subsystem (start with 0).
2. Generate per-subsystem plan via superpowers:writing-plans.
3. Execute per plan; commit each separately.
4. Verify acceptance; merge to main; proceed.
