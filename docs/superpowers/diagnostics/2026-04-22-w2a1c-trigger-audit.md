# W2.A.1c — recompute trigger-site audit

## TL;DR

The bug is: **seed-time COG row creation** (`prisma/seeds/cog-for-contracts.ts`
line 125 and `prisma/seeds/cog-records.ts` line 112) inserts `COGRecord`
rows with the schema default `matchStatus: pending` and never invokes
`recomputeMatchStatusesForVendor` (nor `backfillCOGEnrichment`) afterwards.
Every row the seed inserts therefore stays at `pending` forever. A
secondary gap is `createCOGRecord` in `lib/actions/cog-records.ts` line
111–135 — the single-record UI/API insert path — which also never
invokes recompute.

Fix is: add a post-seed step that calls `recomputeMatchStatusesForVendor`
for every distinct `(vendorId, facilityId)` pair the seed just wrote (or
equivalently, `backfillCOGEnrichment` per facility), and add the same
call to `createCOGRecord` after the `prisma.cOGRecord.create`.

The Arthrex cluster is the demo seed's signature — it was planted by
`cog-for-contracts.ts` with `matchStatus: pending` and nothing ever
flipped it. The matcher and pipeline are correct (W2.A.1 + W2.A.1b); the
data path never fires the trigger.

## Invocation sites

### 1. `lib/actions/cog-import.ts` line ~200 — bulk COG import

**Event:** User uploads a CSV via the "Import COG" UI; server action
`bulkImportCOGRecords` runs after records are persisted.

**Args:** `{ vendorId, facilityId: session.facility.id }`.
`vendorId` is whatever `resolveVendorId(record)` returns for each record
in `data.records` (i.e. the requester's `record.vendorId`, else a
fuzzy-resolved Vendor.id from `resolveVendorIdsBulk`, else `undefined`).

**Iteration scope:** Iterates every distinct `vendorId` across
`data.records` (lines 193–197). ✅ Correct — all vendors in the batch
get recomputed at the current facility.

**Gates:**
- `if (imported > 0)` at line 192 — skipped if no rows were persisted
  (all skipped or all errored). Acceptable.
- `if (vendorIds.size > 0)` at line 199 — skipped if EVERY record in
  the batch has a null/undefined `vendorId`. Rows with `vendorId = null`
  land at `pending` and stay there (recompute is keyed on `vendorId`).
  This is a minor theoretical gap but not the cluster we're diagnosing.
- `try/catch` at lines 204–214 **silently swallows** recompute failures
  with `console.warn`. A thrown error here leaves that vendor's rows at
  their previous status (pending if newly inserted). This is H-E in
  theory, but in practice the probe (W2.A.1b) showed recompute does not
  throw on the Arthrex data.

**Gap analysis:** ✅ Correct for the happy path. Per-vendor iteration
is in place; the per-vendor call is in a try/catch but the function
doesn't actually fail on our data.

### 2. `lib/actions/contracts.ts` line 852 — contract CREATE

**Event:** `createContract` server action; user creates a new contract
from the UI.

**Args:** `{ vendorId: data.vendorId, facilityId: session.facility.id }`.

**Iteration scope:** Single call — one vendor × one facility. Does NOT
iterate `data.facilityIds` / `data.additionalFacilityIds` / the rows in
`ContractFacility` for a multi-facility contract. If a contract covers
facilities A, B, C but the creator is logged into facility A, only A's
COG gets recomputed. ❗ Potential gap for multi-facility contracts
whose COG rows live at a sibling facility — but irrelevant to the
single-facility demo.

**Gates:** None. Unconditional (apart from idempotency short-circuit
above, which returns the cached contract without side effects).

**Gap analysis:** ✅ for single-facility create (the demo path).
⚠️ H-B candidate for multi-facility: a contract created from facility A
that also covers facility B will leave B's COG rows unprocessed. Not
the demo bug.

### 3. `lib/actions/contracts.ts` line 1024 — contract UPDATE

**Event:** `updateContract` server action; user edits an existing
contract.

**Args:** Set of `{ vendorId, facilityId: facility.id }` pairs built
from `contract.vendorId` (always) plus `data.vendorId` if vendor
changed.

**Iteration scope:** Iterates `vendorsToRecompute` (max 2 entries —
old + new vendor). Always includes `contract.vendorId` unconditionally
(line 1019). ✅ Correct for a typical edit — status change, pricing
edits, etc. all hit recompute at the current facility.

**Gates:** None.

**Gap analysis:** ✅ for single-facility update. Same multi-facility
caveat as create. Not the demo bug — status change from draft → active
hits this path and triggers recompute with the current vendor.

### 4. `lib/actions/contracts.ts` line 1125 — contract DELETE

**Event:** `deleteContract` server action.

**Args:** `{ vendorId: existing.vendorId, facilityId: facility.id }`.

**Iteration scope:** Single call. Captured before delete so vendorId
is known.

**Gates:** None.

**Gap analysis:** ✅ Correct. Rows that were on this contract flip to
`off_contract_item` / `unknown_vendor` / `out_of_scope` after delete.

### 5. `lib/actions/pending-contracts.ts` line 224 — pending → active promotion

**Event:** `approvePendingContract` server action; facility admin
approves a vendor-submitted PendingContract, which creates a real
`Contract` (status hard-coded to `"active"` at line 204) + ports
pricingData into `ContractPricing` rows.

**Args:** `{ vendorId: pending.vendorId, facilityId: facility.id }`.

**Iteration scope:** Single call. The promoted contract is
single-facility (line 202 sets `facilityId: facility.id`; no
`contractFacilities` are created).

**Gates:** None.

**Gap analysis:** ✅ Correct for the approve path. Rows should flip
from off_contract → on_contract / price_variance.

### 6. `lib/actions/cog-match.ts` line 107 — vendor-match repair tool

**Event:** "Match Pricing" button (UI action) that re-resolves
vendorName → vendorId for unmatched COG rows.

**Args:** Iterates every `vendorId` in `contractedVendorIds` and calls
`recomputeMatchStatusesForVendor(vendorId, facility.id)`.

**Iteration scope:** All contracted vendors at the facility. ✅ Broad.

**Gates:** None.

**Gap analysis:** ✅ Correct. This is the user-visible remediation
path that W2.A.1b confirmed works.

### 7. `lib/actions/cog-import/backfill.ts` line 48 — `backfillCOGEnrichment`

**Event:** Called manually (UI CTA on empty-state). Iterates all
distinct vendorIds across the facility's active/expiring contracts.

**Args:** `(vendorId, facility.id)`.

**Iteration scope:** ✅ All contracted vendors.

**Gates:** None.

**Gap analysis:** ✅ This is the universal fallback. It is NOT
auto-invoked anywhere — including not by the seed script or by
post-seed setup.

### 8. `lib/actions/cog-import/enrich-batch.ts` line 54 — `recomputeAllCOGEnrichments`

**Event:** Manual admin/facility tool. Iterates every vendorId present
in COG rows.

**Iteration scope:** ✅ All vendors.

**Gates:** try/catch per vendor, swallowed with `console.warn`.

**Gap analysis:** ✅ Broad backfill. Also not auto-invoked.

### 9. `lib/actions/cog-records.ts` line 111–135 — `createCOGRecord` (SINGLE RECORD)

**Event:** Single COG row insertion (UI "Add COG Record" or API). Called
outside the bulk-import path.

**Args:** None — **there is no recompute call at all.**

**Iteration scope:** N/A.

**Gates:** N/A.

**Gap analysis:** ❌ **Invocation gap.** A row inserted here lands at
`matchStatus: pending` (schema default at `prisma/schema.prisma:1042`)
and never gets processed until a separate trigger (contract
create/update/delete, bulk import, or manual backfill) happens to
recompute this vendor at this facility. If the user adds a one-off
record that nobody edits later, it stays pending.

### 10. `prisma/seeds/cog-for-contracts.ts` line 125 — **seed-time bulk insert**

**Event:** `bun prisma db seed` (or manual invocation of this seed
script). Called once to plant demo COG data for the Lighthouse
Community Hospital demo facility.

**Args:** None — **there is no recompute call anywhere in this file.**
Grep for `recompute` and `matchStatus` in this file returns zero hits.

**Iteration scope:** N/A.

**Gates:** N/A.

**Gap analysis:** ❌ **This is the bug.** The seed loops over
contracts, generates COG rows at the contract's vendorId × facility,
calls `prisma.cOGRecord.createMany({ data: rows })`, and moves on to
the next contract. Every row lands at `matchStatus: pending` (schema
default). Nothing downstream flips them. The Arthrex cluster is
exactly what you'd expect: all of Arthrex's seeded COG rows exist at
`matchStatus=pending`, even though an active Arthrex contract with
matching pricing exists at the same facility.

### 11. `prisma/seeds/cog-records.ts` line 112 — secondary seed

**Event:** Older/alternate seed script.

**Gap analysis:** ❌ Same gap — creates COG rows, does not recompute.

## Bug summary

- **H-A. COG bulk import skips recompute or only hits one vendor** —
  ❌ REJECTED. `cog-import.ts` line 193 iterates every distinct
  `vendorId` in `data.records` and line 203 loops over them calling
  recompute with `(vendorId, session.facility.id)`. The set is built
  before the `if (imported > 0)` gate using all records (including
  duplicates / skipped rows). ✅ The bulk-import path is correct.

- **H-B. Contract create passes the wrong facility / misses
  multi-facility join rows** — ⚠️ PARTIALLY TRUE but not the demo
  bug. `createContract` at `contracts.ts:852` only recomputes for
  `session.facility.id`, never for `data.facilityIds` /
  `data.additionalFacilityIds`. A multi-facility contract created from
  facility A leaves sibling facilities' COG rows unrecomputed. Same
  gap in `updateContract` (line 1024) and `deleteContract` (line
  1125). For the demo (single facility), this does not cause the
  Arthrex cluster.

- **H-C. Contract update does not recompute** — ❌ REJECTED.
  `contracts.ts:1018-1028` builds `vendorsToRecompute` with
  `contract.vendorId` unconditionally, then iterates and calls
  recompute. Status change draft → active hits this path and does
  recompute.

- **H-D. Pending → active promotion does not recompute** — ❌
  REJECTED. `pending-contracts.ts:224` calls recompute after promoting.
  The promoted contract is always created with `status: "active"` (line
  204) so `loadContractsForVendor`'s status filter (active/expiring)
  accepts it. ✅ Correct.

- **H-E. try/catch silently swallows recompute errors** — ❌ REJECTED
  as the cause. `cog-import.ts:209-213` and `enrich-batch.ts:60-65` DO
  swallow errors with `console.warn`, but the probe (W2.A.1b) proved
  the pipeline runs cleanly when invoked on Arthrex data and flips
  163/163 rows. The swallow is real but not triggering.

- **[NEW] H-F. Seeds never invoke recompute** — ✅ **CONFIRMED — this
  is the demo bug.** `prisma/seeds/cog-for-contracts.ts:125` and
  `prisma/seeds/cog-records.ts:112` create COG rows and exit; nothing
  downstream fires recompute. Combined with `COGRecord.matchStatus
  @default(pending)` in the schema, every seeded row lives at
  `pending` until a user edits the contract (which is never, in a
  demo session).

- **[NEW] H-G. `createCOGRecord` single-row insert never recomputes**
  — ✅ CONFIRMED as a second (minor) gap. `lib/actions/cog-records.ts`
  lines 111–135 insert one row with no recompute.

## Recommended fix (no code changes in this task — just the written recommendation)

**Primary fix — seed post-processing.** In
`prisma/seeds/cog-for-contracts.ts` (and the parallel
`prisma/seeds/cog-records.ts`), after the outer `for (const contract of
contracts)` loop completes (near the end of the seed export), add one
final pass that collects distinct `(vendorId, facilityId)` pairs from
the contracts just seeded and calls
`recomputeMatchStatusesForVendor(prisma, { vendorId, facilityId })`
once per pair. Import directly from `@/lib/cog/recompute` — the seed
runs outside a request context so the `(db, input)` overload is the
right signature. Alternatively, call `backfillCOGEnrichment` once per
facility, but that requires a session context and is heavier; the
direct per-pair loop is cleaner.

Regression test:
`prisma/seeds/__tests__/cog-for-contracts-recompute.test.ts` (or an
integration test in `lib/actions/__tests__/`) that:
1. Runs the seed against a test DB.
2. Queries `prisma.cOGRecord.count({ where: { facilityId: <demo>,
   matchStatus: 'pending' } })` and asserts it equals 0 for any vendor
   that has an active contract with pricing.
3. Asserts that for the Arthrex cluster specifically, ≥1 row ends up
   at `on_contract` (or `price_variance`).

**Secondary fix — `createCOGRecord`.** In
`lib/actions/cog-records.ts:111-135`, after the `prisma.cOGRecord.create`
call and before `return serialize(record)`, add:
```ts
if (data.vendorId) {
  await recomputeMatchStatusesForVendor(prisma, {
    vendorId: data.vendorId,
    facilityId: session.facility.id,
  }).catch((err) =>
    console.warn(`[createCOGRecord] recompute failed`, err),
  )
}
```
Same swallow pattern as `cog-import.ts` so a transient DB error on
recompute doesn't fail the primary insert.

Regression test:
`lib/actions/__tests__/cog-records-recompute.test.ts` — creates a
contract with pricing, calls `createCOGRecord` with a matching
`vendorItemNo`, asserts the returned/queried row's `matchStatus ===
'on_contract'`.

**Tertiary fix — multi-facility coverage (H-B).** Lower priority; not
the demo bug. In `createContract`, `updateContract`, and
`deleteContract`, iterate `contractFacilities` (plus the primary
`facilityId`) and recompute the vendor at each. Deferred — file a
follow-up ticket; only matters once the app supports cross-facility
COG flows.

## Self-check

1. ✅ Read the full body of every invocation site (cog-import.ts full
   file, contracts.ts create/update/delete sections ±30 lines,
   pending-contracts.ts full file, cog-records.ts, cog-match.ts,
   backfill.ts, enrich-batch.ts, both seed files).
2. ✅ Confirmed cog-import iterates vendors at lines 193–215 — the
   iteration is correct.
3. ✅ Confirmed `createContract` only recomputes for
   `session.facility.id`, not `contractFacilities[]`; noted as H-B but
   not the demo bug.
4. ✅ Bug explained with file:line:
   `prisma/seeds/cog-for-contracts.ts:125` (the `createMany` call with
   no downstream recompute) and `prisma/seeds/cog-records.ts:112`.
