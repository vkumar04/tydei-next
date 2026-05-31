# Group-wide spend & rebate aggregation (#2) — design (2026-05-31)

> Status: **designed, not yet scheduled.** Brainstormed with Vick 2026-05-31;
> set aside to pick up #1 first. All decisions below are confirmed.

## Problem

Grouping is modeled by `Contract.isGrouped` + `Contract.additionalVendorIds[]`
(`schema.prisma:676,683`); the contract's full vendor set is
`[vendorId, ...additionalVendorIds]`. Only the COG **match** recompute is
group-aware (`lib/cog/recompute.ts:48,233`). Five other surfaces scope to
`contract.vendorId` only, so grouped contracts under-report spend, rebates, and
metrics:

1. Rebate accrual — `recompute-accrual.ts` (~7 COG queries on `contract.vendorId`).
2. Compliance + market share — `derived-metrics.ts:71,193`.
3. Contracts-list 12-mo spend cascade — `getContracts` (`contracts.ts:154,261`).
4. Contract-detail "Current Spend (12mo)" card — same cascade logic.
5. Metrics-refresh trigger — `refreshContractMetricsForVendor` (`refresh-metrics.ts:152`).

## Decisions (confirmed)
- **Sequencing:** all 5 surfaces in one spec/PR.
- **Reconcile existing data:** one-time recompute pass.
- **Market-share numerator:** combined group spend (denominator stays total
  category market across all vendors).

## Design

### Canonical helper
`lib/contracts/contract-vendor-ids.ts`:
```ts
export function contractVendorIds(c: {
  vendorId: string | null
  additionalVendorIds?: string[] | null
}): string[] // unique [vendorId, ...additionalVendorIds], drops null/empty
```
Add an invariants-table row ("Contract's full vendor set"). Refactor the
hand-rolled `lib/cog/recompute.ts:233` to use it (single definition).

### Surfaces
1. **`recompute-accrual.ts`** — add `additionalVendorIds` to the contract
   `findUnique` select; replace `vendorId: contract.vendorId` COG filters with
   `vendorId: { in: contractVendorIds(contract) }`. Per-term category filtering
   unchanged. Preserve existing null-vendor guards (empty set → matches nothing).
2. **`derived-metrics.ts`** — select `additionalVendorIds`;
   `vendorSet = new Set(contractVendorIds(contract))`; change the two
   `row.vendorId !== vendorId` filters to `!vendorSet.has(row.vendorId)`.
   Numerator → group spend; denominator unchanged.
3. **`getContracts` cascade (`contracts.ts`)** — sum the `groupBy(['vendorId'])`
   buckets across `contractVendorIds(c)` per contract.
4. **Contract-detail 12-mo spend card** — same logic; keep list-vs-detail parity.
5. **`refresh-metrics.ts`** — query becomes
   `OR: [{ vendorId }, { additionalVendorIds: { has: vendorId } }]`.

### Reconcile
`scripts/recompute-grouped-contracts.ts` — for every contract with non-empty
`additionalVendorIds`, run `recomputeAccrualForContract` + `refreshContractMetrics`.
Idempotent; per-contract before/after log.

## Testing
- Unit: `contractVendorIds` (dedup, null/empty).
- Accrual: 2-vendor grouped contract accrues over combined spend.
- Metrics: market-share numerator sums group vendors; compliance counts group rows.
- Refresh: bulk refresh catches `additionalVendorIds` membership.
- **Oracles (mandatory — rebate engine):** grouped scenario in
  `scripts/oracles/source-scenarios.ts` (group accrual = Σ per-vendor) +
  `full-sweep.ts` + list-vs-detail parity test.

## Implementation note (2026-05-31)

Discovered during build: `recompute-accrual.ts` has multiple per-term-type
sub-writers (volume, po, carve-out, invoice, percent_of_spend) that each take a
single `vendorId: string` and run their own internal COG query. Threading the
vendor set through all of them is a deep, separately-oracle-tested change. This
PR makes group-aware: the **main spend_rebate/threshold COG basis**, the
**market-share engine** (helper now accepts a set), and **every display/metric
surface** (derived-metrics, getContracts list, getContract detail, refresh
trigger). The per-term sub-writers remain primary-vendor-scoped — a tracked
follow-up. No regression: for non-grouped contracts every path is identical to
before (one-element set).

## Out of scope
- Threading the vendor set through the per-term accrual sub-writers
  (volume/po/carve-out/invoice/percent_of_spend) — follow-up.
- #1 (vendor-mapping engine wiring).
