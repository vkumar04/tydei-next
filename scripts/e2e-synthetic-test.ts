/**
 * End-to-end synthetic integration test.
 *
 * Generates a deterministic random scenario (facilities × vendors × contracts
 * × pricing × COG rows) keyed by --seed, seeds it into the real Postgres DB,
 * runs the real `recomputeMatchStatusesForVendor` pipeline, then diffs both
 * facility-POV and vendor-POV server-action-style aggregates against the
 * inline oracle (the `expected` label baked onto every generated COG row).
 *
 * Every DB row created carries the prefix `E2E_<runId>_`. A finally-block
 * deletes every row matching that prefix so even an interrupted run is safe.
 * A pre-run sweep drops any stale `E2E_%` rows from a prior crash.
 *
 * Usage:
 *   bun --env-file=.env scripts/e2e-synthetic-test.ts --seed=42
 *
 * Exits 0 on all-pass, 1 on any mismatch.
 *
 * This script is intentionally long-form rather than modularized — every
 * assertion is visible in one place so a triage reader sees exactly which
 * invariant failed.
 */

import { prisma } from "@/lib/db"
import { recomputeMatchStatusesForVendor } from "@/lib/cog/recompute"
import type { COGMatchStatus } from "@prisma/client"

/**
 * PRICE_VARIANCE_THRESHOLD mirrors lib/contracts/match.ts — kept as a local
 * constant so the oracle is a deliberate re-implementation (any drift shows
 * up as a test failure and forces an intentional sync).
 */
const PRICE_VARIANCE_THRESHOLD_PCT = 2

/* ───────────────────────── deterministic PRNG ──────────────────────── */

/** Mulberry32 — 32-bit seeded PRNG; four lines; returns [0,1). */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

class Rng {
  private next: () => number
  constructor(seed: number) {
    this.next = mulberry32(seed)
  }
  float(): number {
    return this.next()
  }
  int(min: number, maxInclusive: number): number {
    return min + Math.floor(this.next() * (maxInclusive - min + 1))
  }
  pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) throw new Error("Rng.pick on empty array")
    return arr[this.int(0, arr.length - 1)] as T
  }
  /** Weighted pick: pass [{value, weight}]. Weights don't need to sum to 1. */
  weighted<T>(entries: readonly { value: T; weight: number }[]): T {
    const total = entries.reduce((a, e) => a + e.weight, 0)
    const r = this.next() * total
    let acc = 0
    for (const e of entries) {
      acc += e.weight
      if (r <= acc) return e.value
    }
    return entries[entries.length - 1]!.value
  }
}

/* ─────────────────────────── CLI args ──────────────────────────────── */

function parseSeedArg(): number {
  const arg = process.argv.find((a) => a.startsWith("--seed="))
  if (!arg) return 42
  const n = Number(arg.slice("--seed=".length))
  if (!Number.isFinite(n)) throw new Error(`bad --seed: ${arg}`)
  return n
}

/* ───────────────────────── scenario types ──────────────────────────── */

type ExpectedBucket = COGMatchStatus

interface PlannedFacility {
  id: string
  name: string
}
interface PlannedVendor {
  id: string
  name: string
}
interface PlannedPricingItem {
  vendorItemNo: string
  unitPrice: number
  listPrice: number
  category: string | null
}
interface PlannedContract {
  id: string
  name: string
  vendorId: string
  primaryFacilityId: string
  extraFacilityIds: string[]
  effectiveDate: Date
  expirationDate: Date
  pricingItems: PlannedPricingItem[]
}
interface PlannedCog {
  id: string
  facilityId: string
  vendorId: string | null
  vendorItemNo: string | null
  unitCost: number
  quantity: number
  transactionDate: Date
  extendedPrice: number
  expected: ExpectedBucket
  subScenario: string
  /** If the expected bucket is on_contract / price_variance, which contract? */
  expectedContractId: string | null
}

interface Scenario {
  runId: string
  facilities: PlannedFacility[]
  vendors: PlannedVendor[]
  contracts: PlannedContract[]
  cog: PlannedCog[]
}

/* ───────────────────────── scenario builder ────────────────────────── */

const TODAY = new Date() // script runs on today's wallclock
const TRAILING_12MO_START = new Date(TODAY.getTime() - 365 * 24 * 60 * 60 * 1000)
const EFFECTIVE_DATE = new Date("2024-01-01T00:00:00.000Z")
const EXPIRATION_DATE = new Date("2026-12-31T00:00:00.000Z")

/** Coin-flip helpers with named probabilities for readability. */
function buildScenario(seed: number): Scenario {
  const rng = new Rng(seed)
  // runId is seed-derived so repeat runs with the same seed use the same runId
  // (simplifies cleanup). Prefix keeps it collision-free with other E2E runs.
  const runId = `s${seed}_${Date.now().toString(36)}`

  const facilityCount = rng.int(3, 5)
  const vendorCount = rng.int(4, 8)
  const contractCount = rng.int(8, 20)

  const facilities: PlannedFacility[] = Array.from({ length: facilityCount }, (_, i) => ({
    id: "", // filled by create
    name: `E2E_${runId}_Facility_${i}`,
  }))
  const vendors: PlannedVendor[] = Array.from({ length: vendorCount }, (_, i) => ({
    id: "",
    name: `E2E_${runId}_Vendor_${i}`,
  }))

  const contracts: PlannedContract[] = []
  for (let i = 0; i < contractCount; i++) {
    const vendor = vendors[rng.int(0, vendorCount - 1)]!
    const primary = facilities[rng.int(0, facilityCount - 1)]!
    // 25% of contracts are multi-facility (pick 1-2 extra facilities)
    const extras: PlannedFacility[] = []
    if (rng.float() < 0.25 && facilityCount > 1) {
      const extraCount = rng.int(1, Math.min(2, facilityCount - 1))
      const remaining = facilities.filter((f) => f !== primary)
      for (let k = 0; k < extraCount; k++) {
        const pick = remaining[rng.int(0, remaining.length - 1)]!
        if (!extras.includes(pick)) extras.push(pick)
      }
    }
    // ~10% of contracts have ZERO pricing items (exercises cascade fallback)
    const zeroPricing = rng.float() < 0.1
    const pricingCount = zeroPricing ? 0 : rng.int(50, 500)
    const pricingItems: PlannedPricingItem[] = []
    const vendorIndex = vendors.indexOf(vendor)
    for (let p = 0; p < pricingCount; p++) {
      const unitPrice = Math.round((10 + rng.float() * 990) * 100) / 100
      const listPrice = Math.round(unitPrice * (1.1 + rng.float() * 0.4) * 100) / 100
      pricingItems.push({
        vendorItemNo: `E2E_${runId}_V${vendorIndex}_SKU_${p}`,
        unitPrice,
        listPrice,
        category: null,
      })
    }
    contracts.push({
      id: "",
      name: `E2E_${runId}_Contract_${i}`,
      vendorId: vendor.name, // resolved later
      primaryFacilityId: primary.name,
      extraFacilityIds: extras.map((f) => f.name),
      effectiveDate: EFFECTIVE_DATE,
      expirationDate: EXPIRATION_DATE,
      pricingItems,
    })
  }

  // Target 2k-10k total COG rows
  const totalCog = rng.int(2_000, 10_000)

  // Build a (vendor,facility) list of covered pairs for weighting
  const coveredPairs: { vendorId: string; facilityId: string; contractId: string }[] = []
  for (const c of contracts) {
    coveredPairs.push({
      vendorId: c.vendorId,
      facilityId: c.primaryFacilityId,
      contractId: c.name,
    })
    for (const ef of c.extraFacilityIds)
      coveredPairs.push({ vendorId: c.vendorId, facilityId: ef, contractId: c.name })
  }

  const cog: PlannedCog[] = []
  for (let i = 0; i < totalCog; i++) {
    const scen = rng.weighted<string>([
      { value: "clean", weight: 40 },
      { value: "variance", weight: 15 },
      { value: "offcontract_ref", weight: 15 },
      { value: "cross_vendor", weight: 10 },
      { value: "no_ref", weight: 10 },
      { value: "out_of_window", weight: 10 },
    ])
    const txDate = randomDateInWindow(rng, scen === "out_of_window")
    cog.push(buildCogRow(rng, i, scen, txDate, contracts, facilities, vendors, coveredPairs, runId))
  }

  // ─── Edge case riders (explicit sub-scenarios) ───
  // 1. Zero-pricing cascade should fire: find a zero-pricing contract and
  //    add 5 rows with a ref that's not in ANY contract — expected
  //    on_contract via cascade override.
  const zpContract = contracts.find((c) => c.pricingItems.length === 0)
  if (zpContract) {
    for (let k = 0; k < 5; k++) {
      const tx = randomDateInWindow(rng, false)
      cog.push({
        id: "",
        facilityId: zpContract.primaryFacilityId,
        vendorId: zpContract.vendorId,
        vendorItemNo: `E2E_${runId}_ZP_UNKNOWN_SKU_${k}`,
        unitCost: Math.round(rng.float() * 100 * 100) / 100,
        quantity: rng.int(1, 5),
        transactionDate: tx,
        extendedPrice: 0,
        expected: "on_contract",
        subScenario: "edge_zero_pricing_cascade",
        expectedContractId: zpContract.name,
      })
    }
  }

  // 2. Cascade override must NOT fire for contract with pricing but row's
  //    ref isn't on the sheet → should be off_contract_item. Added inside
  //    offcontract_ref distribution already, but annotate 3 explicitly.
  const pricedContract = contracts.find((c) => c.pricingItems.length > 0)
  if (pricedContract) {
    for (let k = 0; k < 3; k++) {
      const tx = randomDateInWindow(rng, false)
      cog.push({
        id: "",
        facilityId: pricedContract.primaryFacilityId,
        vendorId: pricedContract.vendorId,
        vendorItemNo: `E2E_${runId}_OFFSHEET_${k}`,
        unitCost: Math.round(rng.float() * 500 * 100) / 100,
        quantity: rng.int(1, 3),
        transactionDate: tx,
        extendedPrice: 0,
        expected: "off_contract_item",
        subScenario: "edge_offsheet_no_cascade",
        expectedContractId: null,
      })
    }
  }

  // 3. variancePercent extreme — 100,000× catalog price (9,999,900% raw).
  //    The `variancePercent` column is Decimal(6,2) with max ±9,999.99.
  //    `lib/cog/enrichment.ts` clamps the computed variance to that range
  //    (see the `VARIANCE_CLAMP = 9999.99` block in the `price_variance`
  //    case) so the pipeline doesn't throw on extreme-mismatch rows.
  //    This edge-case regression-guards that clamp: a pipeline that
  //    removes the clamp would crash with `ValueOutOfRange`, failing
  //    the test before we even reach the oracle diff.
  if (pricedContract && pricedContract.pricingItems.length > 0) {
    const item = pricedContract.pricingItems[0]!
    const tx = randomDateInWindow(rng, false)
    cog.push({
      id: "",
      facilityId: pricedContract.primaryFacilityId,
      vendorId: pricedContract.vendorId,
      vendorItemNo: item.vendorItemNo,
      unitCost: item.unitPrice * 100_000,
      quantity: 1,
      transactionDate: tx,
      extendedPrice: 0,
      expected: "price_variance",
      subScenario: "edge_variance_extreme",
      expectedContractId: pricedContract.name,
    })
  }

  // 4. Multi-facility: already exercised above; add one explicit row.
  const multiF = contracts.find((c) => c.extraFacilityIds.length > 0 && c.pricingItems.length > 0)
  if (multiF) {
    const item = multiF.pricingItems[0]!
    const fac = multiF.extraFacilityIds[0]!
    const tx = randomDateInWindow(rng, false)
    cog.push({
      id: "",
      facilityId: fac,
      vendorId: multiF.vendorId,
      vendorItemNo: item.vendorItemNo,
      unitCost: item.unitPrice, // exact match
      quantity: 2,
      transactionDate: tx,
      extendedPrice: 0,
      expected: "on_contract",
      subScenario: "edge_multi_facility",
      expectedContractId: multiF.name,
    })
  }

  // 5. Null-vendor edge case. `recomputeMatchStatusesForVendor` is scoped
  //    to a (vendorId, facilityId) pair and never processes null-vendor
  //    rows — that's a real production invariant. A row imported without
  //    a resolvable vendor sits at the schema default `pending` until a
  //    separate import/enrichment path assigns a vendorId. This test
  //    pins that invariant: the app groupBy MUST show these rows at
  //    `pending` after recompute (not `unknown_vendor`, which would
  //    require the pure matcher to have been called with the null row).
  //    If recompute ever starts sweeping null-vendor rows, this test
  //    fires and forces us to decide whether that's desired.
  const anyFacility = facilities[0]!
  for (let n = 0; n < 3; n++) {
    cog.push({
      id: "",
      // Facilities carry their name as their logical id during generation
      // (real DB id gets back-filled after createMany). Use .name here.
      facilityId: anyFacility.name,
      vendorId: null,
      vendorItemNo: "E2E_NULLV_SKU_" + n,
      unitCost: 100,
      quantity: 1,
      transactionDate: randomDateInWindow(rng, false),
      extendedPrice: 0,
      expected: "pending",
      subScenario: "edge_null_vendor",
      expectedContractId: null,
    })
  }

  // Compute extendedPrice now that unit+qty are locked
  for (const row of cog) {
    row.extendedPrice = Math.round(row.unitCost * row.quantity * 100) / 100
  }

  // ─── Oracle pass: re-label `expected` using a minimal re-implementation
  //    of the pipeline's classification rules. The hand-coded labels from
  //    the generator serve only as a hint for HOW to construct the row;
  //    the oracle is the authoritative expectation because it captures
  //    edge cases (e.g. cross-vendor bleed that accidentally lands on a
  //    legitimate ref, null-vendor rows that stay `pending`, dates in
  //    contract window but outside trailing-12mo).
  //
  //    Two oracles drift → test fails → we fix whichever is wrong. This
  //    is the whole point of the check.
  for (const r of cog) {
    const { expected, expectedContractId } = predictExpected(r, contracts)
    r.expected = expected
    r.expectedContractId = expectedContractId
  }

  return { runId, facilities, vendors, contracts, cog }
}

/**
 * Predict the pipeline's output label for a single plan row.
 *
 * Minimal re-implementation of:
 *   lib/contracts/match.ts   (matchCOGRecordToContract)
 *   lib/cog/match.ts         (resolveContractForCOG, cascade)
 *   lib/cog/recompute.ts     (catalogPresent gate + override)
 *
 * Any divergence between this and the real pipeline fails the test.
 */
function predictExpected(
  r: PlannedCog,
  contracts: readonly PlannedContract[],
): { expected: ExpectedBucket; expectedContractId: string | null } {
  // Null-vendor rows: recomputeMatchStatusesForVendor is called per
  // (vendorId, facilityId) pair; null-vendor rows are never processed and
  // stay at the DB default `pending`. Return that so the oracle matches
  // what the app's groupBy will actually show.
  if (!r.vendorId) return { expected: "pending", expectedContractId: null }

  const vendorContracts = contracts.filter(
    (c) => c.vendorId === r.vendorId && includesFacility(c, r.facilityId),
  )
  if (vendorContracts.length === 0) {
    return { expected: "off_contract_item", expectedContractId: null }
  }
  const byDate = vendorContracts.filter(
    (c) => r.transactionDate >= c.effectiveDate && r.transactionDate <= c.expirationDate,
  )
  if (byDate.length === 0) {
    return { expected: "out_of_scope", expectedContractId: null }
  }
  // Item lookup
  if (!r.vendorItemNo) {
    // strict matcher returns off_contract_item (no ref)
    return predictWithCascadeOverride(r, vendorContracts, byDate, null)
  }
  const refLower = r.vendorItemNo.toLowerCase()
  for (const c of byDate) {
    const item = c.pricingItems.find((p) => p.vendorItemNo.toLowerCase() === refLower)
    if (!item) continue
    const variancePct =
      item.unitPrice === 0
        ? 0
        : ((r.unitCost - item.unitPrice) / item.unitPrice) * 100
    if (Math.abs(variancePct) > PRICE_VARIANCE_THRESHOLD_PCT) {
      return { expected: "price_variance", expectedContractId: c.name }
    }
    return { expected: "on_contract", expectedContractId: c.name }
  }
  // No matching item in any in-scope contract → strict matcher says
  // off_contract_item. Override may fire if no contract carries pricing.
  return predictWithCascadeOverride(r, vendorContracts, byDate, null)
}

function includesFacility(c: PlannedContract, facilityId: string): boolean {
  return c.primaryFacilityId === facilityId || c.extraFacilityIds.includes(facilityId)
}

function predictWithCascadeOverride(
  r: PlannedCog,
  vendorContracts: readonly PlannedContract[],
  byDate: readonly PlannedContract[],
  _unused: null,
): { expected: ExpectedBucket; expectedContractId: string | null } {
  // Cascade step 2 (vendorAndDate) requires an active contract covering
  // the transactionDate. The override fires only when NO contract carries
  // a priced catalog (for this vendor, considering all facilities the
  // matcher loaded — i.e. `vendorContracts`, which are facility-scoped).
  const catalogPresent = vendorContracts.some((c) => c.pricingItems.length > 0)
  if (catalogPresent) {
    return { expected: "off_contract_item", expectedContractId: null }
  }
  const hit = byDate[0]
  if (!hit) return { expected: "off_contract_item", expectedContractId: null }
  return { expected: "on_contract", expectedContractId: hit.name }
}

function randomDateInWindow(rng: Rng, outOfWindow: boolean): Date {
  if (outOfWindow) {
    // 50/50: pre-2024-04-23 OR future past today
    if (rng.float() < 0.5) {
      // Pick a date BEFORE trailing-12mo start but still within contract
      // window. trailing starts ~1y ago; contract effective is 2024-01-01.
      // If trailing start > effectiveDate we have room; otherwise use effective.
      const earliest = EFFECTIVE_DATE.getTime()
      const latest = TRAILING_12MO_START.getTime() - 1
      if (latest <= earliest) {
        return new Date(earliest)
      }
      return new Date(earliest + Math.floor(rng.float() * (latest - earliest)))
    } else {
      // Future (past today, within contract expiration)
      const earliest = TODAY.getTime() + 24 * 60 * 60 * 1000
      const latest = EXPIRATION_DATE.getTime()
      if (latest <= earliest) return new Date(latest)
      return new Date(earliest + Math.floor(rng.float() * (latest - earliest)))
    }
  }
  // Normal: inside trailing 12mo AND inside contract window
  const earliest = Math.max(TRAILING_12MO_START.getTime(), EFFECTIVE_DATE.getTime())
  const latest = Math.min(TODAY.getTime(), EXPIRATION_DATE.getTime())
  return new Date(earliest + Math.floor(rng.float() * (latest - earliest)))
}

function buildCogRow(
  rng: Rng,
  idx: number,
  scen: string,
  tx: Date,
  contracts: PlannedContract[],
  facilities: PlannedFacility[],
  vendors: PlannedVendor[],
  coveredPairs: { vendorId: string; facilityId: string; contractId: string }[],
  runId: string,
): PlannedCog {
  // Decide whether this row can land in a covered (vendor,facility) pair
  // ("clean", "variance" need one). For off-contract and cross-vendor we
  // deliberately use a non-covered pair or mismatch refs.
  const hasCovered = coveredPairs.length > 0

  if ((scen === "clean" || scen === "variance") && hasCovered) {
    // pick a random covered pair whose contract has pricing items
    let tries = 0
    while (tries++ < 20) {
      const pair = coveredPairs[rng.int(0, coveredPairs.length - 1)]!
      const contract = contracts.find((c) => c.name === pair.contractId)!
      if (contract.pricingItems.length === 0) continue
      const item = contract.pricingItems[rng.int(0, contract.pricingItems.length - 1)]!
      if (scen === "clean") {
        // within 0.5% of unitPrice — well below 2% threshold
        const drift = 1 + (rng.float() - 0.5) * 0.01 // ±0.5%
        const cost = Math.round(item.unitPrice * drift * 100) / 100
        return {
          id: "",
          facilityId: pair.facilityId,
          vendorId: pair.vendorId,
          vendorItemNo: item.vendorItemNo,
          unitCost: cost,
          quantity: rng.int(1, 10),
          transactionDate: tx,
          extendedPrice: 0,
          expected: "on_contract",
          subScenario: "clean_on_contract",
          expectedContractId: contract.name,
        }
      } else {
        // 5-50% off — well above 2% threshold. Direction random.
        const offPct = 0.05 + rng.float() * 0.45
        const direction = rng.float() < 0.5 ? -1 : 1
        const cost = Math.round(item.unitPrice * (1 + direction * offPct) * 100) / 100
        return {
          id: "",
          facilityId: pair.facilityId,
          vendorId: pair.vendorId,
          vendorItemNo: item.vendorItemNo,
          unitCost: cost,
          quantity: rng.int(1, 10),
          transactionDate: tx,
          extendedPrice: 0,
          expected: "price_variance",
          subScenario: "price_variance",
          expectedContractId: contract.name,
        }
      }
    }
    // fell through — treat as off-contract
  }

  if (scen === "offcontract_ref") {
    // Pick a (vendor,facility) pair but use a ref NOT in any of the vendor's contracts
    const pair = hasCovered ? coveredPairs[rng.int(0, coveredPairs.length - 1)]! : null
    const vendorId = pair?.vendorId ?? vendors[rng.int(0, vendors.length - 1)]!.name
    const facilityId = pair?.facilityId ?? facilities[rng.int(0, facilities.length - 1)]!.name
    return {
      id: "",
      facilityId,
      vendorId,
      vendorItemNo: `E2E_${runId}_BOGUS_REF_${idx}`,
      unitCost: Math.round(rng.float() * 500 * 100) / 100,
      quantity: rng.int(1, 5),
      transactionDate: tx,
      extendedPrice: 0,
      expected: "off_contract_item",
      subScenario: "offcontract_ref_in_pair",
      expectedContractId: null,
    }
  }

  if (scen === "cross_vendor") {
    // vendor A's SKU on vendor B's row → vendor B's catalog doesn't have that SKU
    // → off_contract_item (cross-vendor bleed)
    const contractA = contracts.find((c) => c.pricingItems.length > 0)
    const vendorB = vendors[rng.int(0, vendors.length - 1)]!
    if (contractA && contractA.vendorId !== vendorB.name) {
      const itemA = contractA.pricingItems[rng.int(0, contractA.pricingItems.length - 1)]!
      const facilityId = facilities[rng.int(0, facilities.length - 1)]!.name
      return {
        id: "",
        facilityId,
        vendorId: vendorB.name,
        vendorItemNo: itemA.vendorItemNo,
        unitCost: Math.round(rng.float() * 500 * 100) / 100,
        quantity: rng.int(1, 3),
        transactionDate: tx,
        extendedPrice: 0,
        expected: "off_contract_item",
        subScenario: "cross_vendor_bleed",
        expectedContractId: null,
      }
    }
    // fall through to no_ref if no suitable pair
  }

  if (scen === "no_ref") {
    const facilityId = facilities[rng.int(0, facilities.length - 1)]!.name
    const vendorId = vendors[rng.int(0, vendors.length - 1)]!.name
    return {
      id: "",
      facilityId,
      vendorId,
      vendorItemNo: null,
      unitCost: Math.round(rng.float() * 200 * 100) / 100,
      quantity: rng.int(1, 3),
      transactionDate: tx,
      extendedPrice: 0,
      expected: "off_contract_item",
      subScenario: "no_ref",
      expectedContractId: null,
    }
  }

  if (scen === "out_of_window") {
    // Pick a covered (vendor,facility) pair so vendor/facility are real,
    // but transactionDate is outside the contract window.
    const pair = hasCovered ? coveredPairs[rng.int(0, coveredPairs.length - 1)]! : null
    const contract = pair ? contracts.find((c) => c.name === pair.contractId) : undefined
    const vendorId = pair?.vendorId ?? vendors[rng.int(0, vendors.length - 1)]!.name
    const facilityId = pair?.facilityId ?? facilities[rng.int(0, facilities.length - 1)]!.name
    const item =
      contract && contract.pricingItems.length > 0
        ? contract.pricingItems[rng.int(0, contract.pricingItems.length - 1)]!
        : null
    // Out-of-window with a known ref and vendor → matcher's date filter
    // says out_of_scope; cascade override only fires for
    // vendorAndDate/fuzzy modes (which also require a date window), so
    // result is out_of_scope.
    return {
      id: "",
      facilityId,
      vendorId,
      vendorItemNo: item?.vendorItemNo ?? `E2E_${runId}_NOSUCH_${idx}`,
      unitCost: item ? item.unitPrice : Math.round(rng.float() * 100 * 100) / 100,
      quantity: rng.int(1, 3),
      transactionDate: tx,
      extendedPrice: 0,
      expected: "out_of_scope",
      subScenario: "out_of_window",
      expectedContractId: null,
    }
  }

  // Safe fallback
  const facilityId = facilities[rng.int(0, facilities.length - 1)]!.name
  const vendorId = vendors[rng.int(0, vendors.length - 1)]!.name
  return {
    id: "",
    facilityId,
    vendorId,
    vendorItemNo: `E2E_${runId}_FB_${idx}`,
    unitCost: Math.round(rng.float() * 100 * 100) / 100,
    quantity: 1,
    transactionDate: tx,
    extendedPrice: 0,
    expected: "off_contract_item",
    subScenario: "fallback",
    expectedContractId: null,
  }
}

/* ─────────────────────────── DB seeding ────────────────────────────── */

async function sweepStaleE2E(): Promise<void> {
  // Order matters: children first. COGRecord → ContractPricing → Contract →
  // ContractFacility → Facility/Vendor. We match by names starting with E2E_.
  const deletedCog = await prisma.cOGRecord.deleteMany({
    where: {
      OR: [
        { facility: { name: { startsWith: "E2E_" } } },
        { vendor: { name: { startsWith: "E2E_" } } },
      ],
    },
  })
  const staleContracts = await prisma.contract.findMany({
    where: { name: { startsWith: "E2E_" } },
    select: { id: true },
  })
  const contractIds = staleContracts.map((c) => c.id)
  const deletedPricing = await prisma.contractPricing.deleteMany({
    where: { contractId: { in: contractIds } },
  })
  const deletedContractFac = await prisma.contractFacility.deleteMany({
    where: { contractId: { in: contractIds } },
  })
  const deletedContracts = await prisma.contract.deleteMany({
    where: { name: { startsWith: "E2E_" } },
  })
  const deletedFacilities = await prisma.facility.deleteMany({
    where: { name: { startsWith: "E2E_" } },
  })
  const deletedVendors = await prisma.vendor.deleteMany({
    where: { name: { startsWith: "E2E_" } },
  })
  const any =
    deletedCog.count +
    deletedPricing.count +
    deletedContractFac.count +
    deletedContracts.count +
    deletedFacilities.count +
    deletedVendors.count
  if (any > 0) {
    console.log(
      `[sweep] removed stale E2E rows — cog=${deletedCog.count}, pricing=${deletedPricing.count}, contractFac=${deletedContractFac.count}, contracts=${deletedContracts.count}, facilities=${deletedFacilities.count}, vendors=${deletedVendors.count}`,
    )
  }
}

async function seedScenario(scenario: Scenario): Promise<void> {
  // Facilities
  for (const f of scenario.facilities) {
    const created = await prisma.facility.create({
      data: { name: f.name, type: "hospital", status: "active" },
      select: { id: true },
    })
    f.id = created.id
  }
  // Vendors
  for (const v of scenario.vendors) {
    const created = await prisma.vendor.create({
      data: { name: v.name, status: "active" },
      select: { id: true },
    })
    v.id = created.id
  }
  // Resolve name→id on contracts and COG
  const facByName = new Map(scenario.facilities.map((f) => [f.name, f.id]))
  const venByName = new Map(scenario.vendors.map((v) => [v.name, v.id]))

  // Contracts
  for (const c of scenario.contracts) {
    const primaryFid = facByName.get(c.primaryFacilityId)!
    const vid = venByName.get(c.vendorId)!
    const isMulti = c.extraFacilityIds.length > 0
    const created = await prisma.contract.create({
      data: {
        name: c.name,
        vendorId: vid,
        facilityId: primaryFid,
        contractType: "usage",
        status: "active",
        effectiveDate: c.effectiveDate,
        expirationDate: c.expirationDate,
        isMultiFacility: isMulti,
      },
      select: { id: true },
    })
    c.id = created.id
    // contractFacility links (primary + extras)
    const allLinkFacs = new Set<string>([primaryFid, ...c.extraFacilityIds.map((n) => facByName.get(n)!)])
    await prisma.contractFacility.createMany({
      data: Array.from(allLinkFacs).map((facilityId) => ({
        contractId: created.id,
        facilityId,
      })),
    })
    // pricing
    if (c.pricingItems.length > 0) {
      // chunk at 5k to avoid parameter-cap issues
      const CHUNK = 5_000
      for (let i = 0; i < c.pricingItems.length; i += CHUNK) {
        const slice = c.pricingItems.slice(i, i + CHUNK)
        await prisma.contractPricing.createMany({
          data: slice.map((p) => ({
            contractId: created.id,
            vendorItemNo: p.vendorItemNo,
            unitPrice: p.unitPrice,
            listPrice: p.listPrice,
            uom: "EA",
          })),
        })
      }
    }
  }

  // COG rows — createMany, chunked
  const CHUNK = 5_000
  for (let i = 0; i < scenario.cog.length; i += CHUNK) {
    const slice = scenario.cog.slice(i, i + CHUNK)
    await prisma.cOGRecord.createMany({
      data: slice.map((r, idx) => ({
        facilityId: facByName.get(r.facilityId)!,
        vendorId: r.vendorId ? venByName.get(r.vendorId)! : null,
        vendorName: r.vendorId,
        inventoryNumber: `E2E_INV_${i + idx}`,
        inventoryDescription: `E2E synthetic row ${i + idx}`,
        vendorItemNo: r.vendorItemNo,
        unitCost: r.unitCost,
        extendedPrice: r.extendedPrice,
        quantity: r.quantity,
        transactionDate: r.transactionDate,
      })),
    })
  }
  // Back-fill planned-row ids by matching inventoryNumber→real id so later
  // assertions can tie oracle rows to DB rows. We don't strictly need ids for
  // aggregate-level diffs, but grabbing them lets us sanity-check.
  const created = await prisma.cOGRecord.findMany({
    where: { inventoryNumber: { startsWith: `E2E_INV_` }, facility: { name: { startsWith: `E2E_${scenario.runId}_` } } },
    select: { id: true, inventoryNumber: true },
  })
  const byInv = new Map(created.map((r) => [r.inventoryNumber, r.id]))
  scenario.cog.forEach((r, i) => {
    const id = byInv.get(`E2E_INV_${i}`)
    if (id) r.id = id
  })
  // Resolve vendor/facility IDs onto plan rows for later diffing
  scenario.cog.forEach((r) => {
    r.facilityId = facByName.get(r.facilityId)!
    r.vendorId = r.vendorId ? venByName.get(r.vendorId)! : null
  })
  scenario.contracts.forEach((c) => {
    c.vendorId = venByName.get(c.vendorId)!
    c.primaryFacilityId = facByName.get(c.primaryFacilityId)!
    c.extraFacilityIds = c.extraFacilityIds.map((n) => facByName.get(n)!)
  })
  scenario.facilities.forEach((f) => {
    /* id already filled */
  })
  scenario.vendors.forEach((v) => {
    /* id already filled */
  })
}

/* ───────────────────────── recompute runner ────────────────────────── */

async function runRecompute(scenario: Scenario): Promise<void> {
  const pairs = new Set<string>()
  for (const r of scenario.cog) {
    if (r.vendorId) pairs.add(`${r.vendorId}__${r.facilityId}`)
  }
  console.log(`[recompute] running ${pairs.size} vendor×facility pair(s)`)
  for (const key of pairs) {
    const [vendorId, facilityId] = key.split("__") as [string, string]
    const summary = await recomputeMatchStatusesForVendor(prisma, { vendorId, facilityId })
    console.log(
      `  pair ${vendorId.slice(-6)}×${facilityId.slice(-6)} total=${summary.total} on=${summary.onContract} var=${summary.priceVariance} off=${summary.offContract} oos=${summary.outOfScope} unk=${summary.unknownVendor}`,
    )
  }
}

/* ───────────────────────── oracle aggregation ──────────────────────── */

interface BucketAgg {
  count: number
  spend: number
}
type BucketMap = Map<ExpectedBucket, BucketAgg>

function emptyBucketMap(): BucketMap {
  const m = new Map<ExpectedBucket, BucketAgg>()
  for (const b of [
    "on_contract",
    "price_variance",
    "off_contract_item",
    "out_of_scope",
    "unknown_vendor",
    "pending",
  ] as const) {
    m.set(b, { count: 0, spend: 0 })
  }
  return m
}

function oracleByFacility(scenario: Scenario): Map<string, BucketMap> {
  const out = new Map<string, BucketMap>()
  for (const f of scenario.facilities) out.set(f.id, emptyBucketMap())
  for (const r of scenario.cog) {
    const b = out.get(r.facilityId)!.get(r.expected)!
    b.count += 1
    b.spend += r.extendedPrice
  }
  return out
}

function oracleByVendorFacility(scenario: Scenario): Map<string, BucketMap> {
  // key = `${vendorId}__${facilityId}`; null vendor excluded (unknown_vendor only appears facility-side)
  const out = new Map<string, BucketMap>()
  for (const r of scenario.cog) {
    if (!r.vendorId) continue
    const k = `${r.vendorId}__${r.facilityId}`
    if (!out.has(k)) out.set(k, emptyBucketMap())
    const b = out.get(k)!.get(r.expected)!
    b.count += 1
    b.spend += r.extendedPrice
  }
  return out
}

/* ─────────────────────────── app queries ───────────────────────────── */

async function appFacilityAggregates(facilityId: string): Promise<BucketMap> {
  const rows = await prisma.cOGRecord.groupBy({
    by: ["matchStatus"],
    where: { facilityId, inventoryNumber: { startsWith: "E2E_INV_" } },
    _count: { _all: true },
    _sum: { extendedPrice: true },
  })
  const m = emptyBucketMap()
  for (const r of rows) {
    const b = m.get(r.matchStatus as ExpectedBucket)
    if (!b) continue
    b.count = r._count._all
    b.spend = Number(r._sum.extendedPrice ?? 0)
  }
  return m
}

async function appVendorFacilityAggregates(
  vendorId: string,
  facilityId: string,
): Promise<BucketMap> {
  const rows = await prisma.cOGRecord.groupBy({
    by: ["matchStatus"],
    where: { vendorId, facilityId, inventoryNumber: { startsWith: "E2E_INV_" } },
    _count: { _all: true },
    _sum: { extendedPrice: true },
  })
  const m = emptyBucketMap()
  for (const r of rows) {
    const b = m.get(r.matchStatus as ExpectedBucket)
    if (!b) continue
    b.count = r._count._all
    b.spend = Number(r._sum.extendedPrice ?? 0)
  }
  return m
}

/* ───────────────────────────── diff/report ─────────────────────────── */

interface Failure {
  where: string
  detail: string
}

const CENT = 0.01

function diffBuckets(label: string, expected: BucketMap, actual: BucketMap, failures: Failure[]): void {
  for (const [bucket, exp] of expected) {
    const act = actual.get(bucket)!
    if (exp.count !== act.count) {
      failures.push({
        where: label,
        detail: `${bucket} count: expected=${exp.count} actual=${act.count}`,
      })
    }
    if (Math.abs(exp.spend - act.spend) > CENT) {
      failures.push({
        where: label,
        detail: `${bucket} spend: expected=${exp.spend.toFixed(2)} actual=${act.spend.toFixed(2)} delta=${(act.spend - exp.spend).toFixed(2)}`,
      })
    }
  }
}

function printMatrix(title: string, byKey: Map<string, BucketMap>): void {
  console.log(`\n── ${title} ──`)
  console.log(
    "key".padEnd(26) +
      "on_contract".padStart(18) +
      "price_variance".padStart(18) +
      "off_contract".padStart(18) +
      "out_of_scope".padStart(18) +
      "unknown".padStart(18) +
      "pending".padStart(18),
  )
  for (const [k, buckets] of byKey) {
    const row = [
      k.slice(-24).padEnd(26),
      fmtBucket(buckets.get("on_contract")!).padStart(18),
      fmtBucket(buckets.get("price_variance")!).padStart(18),
      fmtBucket(buckets.get("off_contract_item")!).padStart(18),
      fmtBucket(buckets.get("out_of_scope")!).padStart(18),
      fmtBucket(buckets.get("unknown_vendor")!).padStart(18),
      fmtBucket(buckets.get("pending")!).padStart(18),
    ].join("")
    console.log(row)
  }
}

function fmtBucket(b: BucketAgg): string {
  return `${b.count}/$${b.spend.toFixed(0)}`
}

/* ──────────────────────── cross-view consistency ───────────────────── */

async function crossViewConsistency(scenario: Scenario, failures: Failure[]): Promise<void> {
  // 1. Per (vendor,facility,on_contract) — facility view sum == vendor view sum.
  //    (Both queries hit the same DB rows, so this checks the WHERE clause
  //    semantics rather than reducer drift, but it guards a regression where
  //    one view accidentally gains/drops a filter.)
  for (const f of scenario.facilities) {
    for (const v of scenario.vendors) {
      const vf = await prisma.cOGRecord.aggregate({
        where: {
          facilityId: f.id,
          vendorId: v.id,
          matchStatus: "on_contract",
          inventoryNumber: { startsWith: "E2E_INV_" },
        },
        _sum: { extendedPrice: true },
      })
      const vendorSide = await prisma.cOGRecord.aggregate({
        where: {
          vendorId: v.id,
          facilityId: f.id,
          matchStatus: "on_contract",
          inventoryNumber: { startsWith: "E2E_INV_" },
        },
        _sum: { extendedPrice: true },
      })
      const a = Number(vf._sum.extendedPrice ?? 0)
      const b = Number(vendorSide._sum.extendedPrice ?? 0)
      if (Math.abs(a - b) > CENT) {
        failures.push({
          where: `cross-view[${f.name}×${v.name}]`,
          detail: `facility-side on_contract=${a.toFixed(2)} vs vendor-side on_contract=${b.toFixed(2)}`,
        })
      }
    }
  }

  // 2. Sum of per-vendor totals at facility F == facility total.
  for (const f of scenario.facilities) {
    const facTotal = await prisma.cOGRecord.aggregate({
      where: { facilityId: f.id, inventoryNumber: { startsWith: "E2E_INV_" } },
      _sum: { extendedPrice: true },
    })
    let perVendorSum = 0
    for (const v of scenario.vendors) {
      const r = await prisma.cOGRecord.aggregate({
        where: { facilityId: f.id, vendorId: v.id, inventoryNumber: { startsWith: "E2E_INV_" } },
        _sum: { extendedPrice: true },
      })
      perVendorSum += Number(r._sum.extendedPrice ?? 0)
    }
    // plus null-vendor rows at this facility (unknown_vendor edge case)
    const nullVendor = await prisma.cOGRecord.aggregate({
      where: { facilityId: f.id, vendorId: null, inventoryNumber: { startsWith: "E2E_INV_" } },
      _sum: { extendedPrice: true },
    })
    perVendorSum += Number(nullVendor._sum.extendedPrice ?? 0)
    const facSum = Number(facTotal._sum.extendedPrice ?? 0)
    if (Math.abs(facSum - perVendorSum) > CENT) {
      failures.push({
        where: `cross-view[facility-sum]`,
        detail: `${f.name}: facility=${facSum.toFixed(2)} sum(per-vendor)=${perVendorSum.toFixed(2)}`,
      })
    }
  }
}

/* ───────────────────── contract trailing-12mo check ────────────────── */

async function trailing12MoCheck(scenario: Scenario, failures: Failure[]): Promise<void> {
  // For each contract, oracle = sum of extendedPrice for COG rows where the
  // pipeline classified the row as on_contract/price_variance to THIS contract
  // AND transactionDate within trailing 12mo. Compare to a grouped DB query.
  for (const c of scenario.contracts) {
    // Oracle: planned rows whose expectedContractId == this contract AND
    // expected ∈ {on_contract, price_variance} AND date in trailing window.
    let oracleSpend = 0
    for (const r of scenario.cog) {
      if (r.expectedContractId !== c.name) continue // name wasn't resolved to id on plan, skip
    }
    // Since we resolved plan names → ids earlier for vendor/facility only, we
    // need a separate lookup. Contract ids on the plan were filled on create,
    // but `expectedContractId` still holds the pre-id name. Fix: map names→ids.
    const cnameToId = new Map(scenario.contracts.map((x) => [x.name, x.id]))
    for (const r of scenario.cog) {
      if (!r.expectedContractId) continue
      const resolvedContractId = cnameToId.get(r.expectedContractId) ?? r.expectedContractId
      if (resolvedContractId !== c.id) continue
      if (r.expected !== "on_contract" && r.expected !== "price_variance") continue
      if (r.transactionDate < TRAILING_12MO_START || r.transactionDate > TODAY) continue
      oracleSpend += r.extendedPrice
    }
    // App-side: DB groupBy filtered on contractId + date window
    const appAgg = await prisma.cOGRecord.aggregate({
      where: {
        contractId: c.id,
        transactionDate: { gte: TRAILING_12MO_START, lte: TODAY },
        inventoryNumber: { startsWith: "E2E_INV_" },
      },
      _sum: { extendedPrice: true },
    })
    const appSpend = Number(appAgg._sum.extendedPrice ?? 0)
    if (Math.abs(oracleSpend - appSpend) > CENT) {
      failures.push({
        where: `trailing12[${c.name}]`,
        detail: `oracle=${oracleSpend.toFixed(2)} app=${appSpend.toFixed(2)} delta=${(appSpend - oracleSpend).toFixed(2)}`,
      })
    }
  }
}

/* ────────────────────── v0-parity checks ────────────────────────── */

async function v0ParityChecks(failures: Failure[]): Promise<void> {
  const {
    v0Cumulative,
    v0Marginal,
    v0TierProgress,
    v0PriceVariance,
    v0TieInAllOrNothing,
    v0TieInProportional,
    v0QuarterlyTrueUp,
    v0AnnualSettlement,
  } = await import("@/lib/v0-spec/rebate-math")
  const { calculateCumulative, calculateMarginal } = await import(
    "@/lib/rebates/calculate"
  )

  const approx = (a: number, b: number, eps = 0.01) => Math.abs(a - b) <= eps

  // ─── Doc example 1 — cumulative $75k / 3 tiers → $2,250 ──────────
  // docs/contract-calculations.md §2
  const tiersA = [
    { tierNumber: 1, spendMin: 0, spendMax: 50_000, rebateValue: 2 },
    { tierNumber: 2, spendMin: 50_000, spendMax: 100_000, rebateValue: 3 },
    { tierNumber: 3, spendMin: 100_000, spendMax: null, rebateValue: 4 },
  ]
  const spec75 = v0Cumulative(75_000, tiersA)
  if (!approx(spec75.rebateEarned, 2250)) {
    failures.push({
      where: "v0 cumulative self-check",
      detail: `$75k/tiersA → expected $2,250, got ${spec75.rebateEarned}`,
    })
  }
  const tydei75 = calculateCumulative(
    75_000,
    tiersA.map((t) => ({ ...t, tierName: null })),
  )
  if (!approx(tydei75.rebateEarned, spec75.rebateEarned)) {
    failures.push({
      where: "v0 cumulative vs tydei",
      detail: `$75k → v0 ${spec75.rebateEarned}, tydei ${tydei75.rebateEarned}`,
    })
  }

  // ─── Doc example 2 — marginal $125k → $3,500 ─────────────────────
  const spec125 = v0Marginal(125_000, tiersA)
  if (!approx(spec125.rebateEarned, 3500)) {
    failures.push({
      where: "v0 marginal self-check",
      detail: `$125k/tiersA → expected $3,500, got ${spec125.rebateEarned}`,
    })
  }
  const tydei125 = calculateMarginal(
    125_000,
    tiersA.map((t) => ({ ...t, tierName: null })),
  )
  if (!approx(tydei125.rebateEarned, spec125.rebateEarned)) {
    failures.push({
      where: "v0 marginal vs tydei",
      detail: `$125k → v0 ${spec125.rebateEarned}, tydei ${tydei125.rebateEarned}`,
    })
  }

  // ─── Doc example 3 — tier progression $35k → 70% / $15k ──────────
  // docs/contract-calculations.md §3
  const tiersB = [
    { tierNumber: 1, spendMin: 0, spendMax: 50_000, rebateValue: 2 },
    { tierNumber: 2, spendMin: 50_000, spendMax: null, rebateValue: 3 },
  ]
  const prog = v0TierProgress(35_000, tiersB)
  if (
    !approx(prog.progressPct, 70) ||
    !approx(prog.amountToNextTier, 15_000) ||
    prog.currentTierNumber !== 1 ||
    prog.nextTierNumber !== 2
  ) {
    failures.push({
      where: "v0 tier progression self-check",
      detail: `$35k/tiersB → expected tier 1→2 @ 70% / $15k, got ${JSON.stringify(prog)}`,
    })
  }

  // ─── Doc example 4 — price variance severity bands ───────────────
  // docs/contract-calculations.md §6: ≤2% ACCEPTABLE, ≤5% WARNING, >5% CRITICAL
  const cases: Array<[number, number, string]> = [
    [100, 100, "ACCEPTABLE"], // 0% exact
    [101, 100, "ACCEPTABLE"], // 1%
    [102, 100, "ACCEPTABLE"], // 2% edge
    [103, 100, "WARNING"], // 3%
    [105, 100, "WARNING"], // 5% edge
    [106, 100, "CRITICAL"], // 6%
    [94, 100, "WARNING"], // -6%… actually -6% is CRITICAL
    [95, 100, "WARNING"], // -5% edge
  ]
  // Above hand-authored expectations include one deliberate cross-check:
  // -6% should be CRITICAL. Overwrite the 94/100 case accordingly.
  cases[6] = [94, 100, "CRITICAL"]
  for (const [actual, contract, expected] of cases) {
    const v = v0PriceVariance(actual, contract)
    if (v.severity !== expected) {
      failures.push({
        where: "v0 price-variance severity",
        detail: `actual=${actual}, contract=${contract} → expected ${expected}, got ${v.severity}`,
      })
    }
  }

  // ─── Doc example 5 — tie-in all-or-nothing base compliance ───────
  // §4 "exactly at minimums" → base rate applies. Spends [$25k,$40k,$35k],
  // baseRate 2% → $100k × 2% = $2,000.
  const tieInAon = v0TieInAllOrNothing(
    [
      { minimumSpend: 25_000, currentSpend: 25_000 },
      { minimumSpend: 40_000, currentSpend: 40_000 },
      { minimumSpend: 35_000, currentSpend: 35_000 },
    ],
    { baseRate: 2 },
  )
  if (!tieInAon.compliant || !approx(tieInAon.rebateEarned, 2_000)) {
    failures.push({
      where: "v0 tie-in all-or-nothing self-check",
      detail: `expected compliant + $2,000, got ${JSON.stringify(tieInAon)}`,
    })
  }

  // ─── Doc example 6 — tie-in proportional compliance ──────────────
  // §4 "Proportional": spends [$20k,$40k,$28k] / minimums [$25k,$40k,$35k]
  // with weights [30%,40%,30%], baseRate 2% → overall 0.88, rebate $1,548.80.
  const tieInProp = v0TieInProportional(
    [
      { minimumSpend: 25_000, currentSpend: 20_000, weight: 0.3 },
      { minimumSpend: 40_000, currentSpend: 40_000, weight: 0.4 },
      { minimumSpend: 35_000, currentSpend: 28_000, weight: 0.3 },
    ],
    2,
  )
  if (
    !approx(tieInProp.overallCompliance, 0.88, 0.001) ||
    !approx(tieInProp.rebateEarned, 1548.8)
  ) {
    failures.push({
      where: "v0 tie-in proportional self-check",
      detail: `expected 0.88 compliance + $1,548.80, got ${JSON.stringify(tieInProp)}`,
    })
  }

  // ─── Doc example 7 — quarterly true-up ───────────────────────────
  // Q1 monthly accruals [$800, $900, $1050] sum to $2,750. Actual Q1
  // rebate on $100k cumulative spend with tiersA — $100k exactly hits
  // the tier-3 spendMin (4%), so actual = $100k × 4% = $4,000.
  // Adjustment = $4,000 − $2,750 = +$1,250 additional owed.
  const trueUp = v0QuarterlyTrueUp(100_000, tiersA, [800, 900, 1050])
  if (!approx(trueUp.adjustment, 1_250)) {
    failures.push({
      where: "v0 quarterly true-up self-check",
      detail: `expected +$1,250 adjustment, got ${trueUp.adjustment}`,
    })
  }

  // ─── Doc example 8 — annual settlement ───────────────────────────
  // Annual spend $500k on tiersA (cumulative) = $500k × 4% = $20,000.
  // Sum of YTD accruals $10,000 → settlement = $10,000 due.
  const settle = v0AnnualSettlement(500_000, tiersA, [10_000])
  if (!approx(settle.settlementAmount, 10_000)) {
    failures.push({
      where: "v0 annual settlement self-check",
      detail: `expected $10,000 settlement, got ${settle.settlementAmount}`,
    })
  }

  // ─── v0 Rebate Optimizer · spend-to-next-tier ROI ───────────────
  // $420k @ 3.5% now, next tier $500k @ 4%. Incremental gain to hit
  // next tier = $20k − $14,700 = $5,300 on $80k additional spend.
  const {
    v0RebateOpportunity,
    v0UrgencyForGap,
    v0ProgressPctToNextTier,
  } = await import("@/lib/v0-spec/rebate-optimizer")
  const op = v0RebateOpportunity({
    currentSpend: 420_000,
    currentRebatePercent: 3.5,
    nextThreshold: 500_000,
    nextRebatePercent: 4,
  })
  if (!approx(op.currentRebate, 14_700) || !approx(op.additionalRebate, 5_300) || !approx(op.spendNeeded, 80_000)) {
    failures.push({ where: "v0 rebate opportunity", detail: JSON.stringify(op) })
  }
  if (v0UrgencyForGap(80_000) !== "high") {
    failures.push({ where: "v0 urgency", detail: "80k gap should be high urgency" })
  }
  if (!approx(v0ProgressPctToNextTier(420_000, 500_000), 84)) {
    failures.push({ where: "v0 progressPct", detail: "expected 84% progress" })
  }

  // ─── v0 Renewals ────────────────────────────────────────────────
  const { v0DaysRemaining, v0RenewalStatus, v0CommitmentMetPct } =
    await import("@/lib/v0-spec/renewals")
  const baseline = new Date("2026-04-23")
  const in50 = new Date(baseline.getTime() + 50 * 86_400_000)
  if (v0DaysRemaining(in50, baseline) !== 50) {
    failures.push({ where: "v0 daysRemaining", detail: "expected 50" })
  }
  if (v0RenewalStatus(30) !== "critical" || v0RenewalStatus(60) !== "warning" || v0RenewalStatus(150) !== "upcoming" || v0RenewalStatus(200) !== "ok") {
    failures.push({ where: "v0 renewal status", detail: "band mismatch" })
  }
  if (v0CommitmentMetPct(420_000, 600_000) !== 70) {
    failures.push({ where: "v0 commitment met", detail: "expected 70" })
  }

  // ─── v0 COG · vendor key + variance bands + trend ───────────────
  const {
    v0NormalizeVendorKey,
    v0ContractSpendSplit,
    v0CogPriceVarianceBand,
    v0SpendTrend,
  } = await import("@/lib/v0-spec/cog")
  if (v0NormalizeVendorKey("Medtronic, Inc.") !== "medtronic") {
    failures.push({ where: "v0 vendor key norm", detail: "expected 'medtronic'" })
  }
  const split = v0ContractSpendSplit([
    { totalCost: 700_000, hasContractPricing: true },
    { totalCost: 300_000, hasContractPricing: false },
  ])
  if (!approx(split.compliancePct, 70)) {
    failures.push({ where: "v0 cog split", detail: JSON.stringify(split) })
  }
  if (v0CogPriceVarianceBand(103, 100).band !== "minor_overcharge") {
    failures.push({ where: "v0 cog band 3%", detail: "expected minor_overcharge" })
  }
  if (v0CogPriceVarianceBand(106, 100).band !== "significant_overcharge") {
    failures.push({ where: "v0 cog band 6%", detail: "expected significant_overcharge" })
  }
  if (v0CogPriceVarianceBand(94, 100).band !== "significant_discount") {
    failures.push({ where: "v0 cog band -6%", detail: "expected significant_discount" })
  }
  const trend = v0SpendTrend([100, 100, 100, 120, 130, 125])
  if (trend.trend !== "up") {
    failures.push({ where: "v0 spend trend", detail: JSON.stringify(trend) })
  }

  // ─── v0 Margins ─────────────────────────────────────────────────
  const { v0Margins, v0RebateAllocationToProcedure } = await import(
    "@/lib/v0-spec/margins"
  )
  const m = v0Margins({
    revenue: 10_000,
    supplyCosts: 4_000,
    laborCosts: 2_000,
    overheadCosts: 1_000,
    rebateAllocation: 500,
  })
  if (!approx(m.standardMarginPct, 30) || !approx(m.trueMarginPct, 35)) {
    failures.push({ where: "v0 margins", detail: JSON.stringify(m) })
  }
  if (
    !approx(
      v0RebateAllocationToProcedure({
        procedureVendorSpend: 10_000,
        vendorTotalSpend: 100_000,
        vendorTotalRebate: 3_000,
      }),
      300,
    )
  ) {
    failures.push({ where: "v0 rebate alloc", detail: "expected 300" })
  }

  // ─── v0 Case costing ────────────────────────────────────────────
  const {
    v0DefaultTierRebatePct,
    v0SpecialtyFromCPT,
    v0SpecialtyPaymentMultiplier,
    v0SurgeonScore,
    v0CMIAdjustedSpend,
  } = await import("@/lib/v0-spec/case-costing")
  if (v0DefaultTierRebatePct(2) !== 4) {
    failures.push({ where: "v0 tier 2 default", detail: "expected 4%" })
  }
  if (v0SpecialtyFromCPT("27447") !== "orthopedic" || v0SpecialtyFromCPT("33533") !== "cardiac" || v0SpecialtyFromCPT("63030") !== "spine") {
    failures.push({ where: "v0 specialty from cpt", detail: "mismatch" })
  }
  if (v0SpecialtyPaymentMultiplier("cardiac") !== 1.2 || v0SpecialtyPaymentMultiplier("spine") !== 1.3) {
    failures.push({ where: "v0 specialty multiplier", detail: "mismatch" })
  }
  const ss = v0SurgeonScore({
    payorMixPct: 80,
    bmiUnder40Pct: 90,
    ageUnder65Pct: 70,
    avgSpend: 5_000,
    avgCaseTimeMinutes: 120,
  })
  // spend = 100 − 5000/500 = 90; time = 100 − 120/5 = 76
  if (!approx(ss.spend, 90) || !approx(ss.time, 76)) {
    failures.push({ where: "v0 surgeon score", detail: JSON.stringify(ss) })
  }
  if (!approx(v0CMIAdjustedSpend(1_200, 1.2), 1_000)) {
    failures.push({ where: "v0 cmi adjusted", detail: "expected 1000" })
  }

  // ─── v0 Proposal scoring ────────────────────────────────────────
  const {
    v0CostSavingsScore,
    v0PriceCompetitivenessScore,
    v0RebateAttainabilityScore,
    v0LockInRiskScore,
    v0TcoScore,
    v0OverallProposalScore,
    v0ProposalRecommendation,
  } = await import("@/lib/v0-spec/proposal-scoring")
  // 20% savings → 10; 10% → 5
  if (
    !approx(v0CostSavingsScore({ currentSpend: 100, proposedAnnual: 80 }).score, 10) ||
    !approx(v0CostSavingsScore({ currentSpend: 100, proposedAnnual: 90 }).score, 5)
  ) {
    failures.push({ where: "v0 cost savings score", detail: "mismatch" })
  }
  // at-market = 5.0; 4% below = 6.0
  if (
    !approx(v0PriceCompetitivenessScore({ benchmark: 100, proposedAnnual: 100 }), 5) ||
    !approx(v0PriceCompetitivenessScore({ benchmark: 100, proposedAnnual: 96 }), 6)
  ) {
    failures.push({ where: "v0 price comp score", detail: "mismatch" })
  }
  // 2× minimum = 10
  if (!approx(v0RebateAttainabilityScore({ currentSpend: 200, minimumSpend: 100 }), 10)) {
    failures.push({ where: "v0 rebate attainability", detail: "mismatch" })
  }
  // worst case: 4 years + exclusivity + 80% market + min > 0.8×total = 10-9 = 1
  if (
    v0LockInRiskScore({
      contractLengthYears: 4,
      exclusivity: true,
      marketSharePct: 80,
      minimumSpend: 90,
      totalValue: 100,
    }) !== 1
  ) {
    failures.push({ where: "v0 lockin", detail: "expected 1" })
  }
  // priceProtection + net60 + 6% volume discount = 10
  if (
    v0TcoScore({ priceProtection: true, paymentTerms: "net60", volumeDiscountPct: 6 }) !==
    10
  ) {
    failures.push({ where: "v0 tco score", detail: "expected 10" })
  }
  // weighted overall: all 10 → 10, all 5 → 5
  if (
    !approx(
      v0OverallProposalScore({
        costSavings: 10,
        priceCompetitiveness: 10,
        rebateAttainability: 10,
        lockInRisk: 10,
        tco: 10,
      }),
      10,
    )
  ) {
    failures.push({ where: "v0 overall 10", detail: "mismatch" })
  }
  if (v0ProposalRecommendation({ overall: 8, risksCount: 0 }) !== "accept") {
    failures.push({ where: "v0 rec accept", detail: "8/0 should accept" })
  }
  if (v0ProposalRecommendation({ overall: 3, risksCount: 2 }) !== "decline") {
    failures.push({ where: "v0 rec decline", detail: "3/2 should decline" })
  }
  if (v0ProposalRecommendation({ overall: 6, risksCount: 2 }) !== "negotiate") {
    failures.push({ where: "v0 rec negotiate", detail: "6/2 should negotiate" })
  }

  // ─── v0 Invoice validation priority ─────────────────────────────
  const { v0InvoicePriority } = await import("@/lib/v0-spec/invoice-validation")
  if (v0InvoicePriority({ variancePct: 6 }) !== "high") {
    failures.push({ where: "v0 invoice priority >5%", detail: "expected high" })
  }
  if (v0InvoicePriority({ variancePct: 3 }) !== "medium") {
    failures.push({ where: "v0 invoice priority 3%", detail: "expected medium" })
  }
  if (v0InvoicePriority({ variancePct: 0, nonMatchingItem: true }) !== "high") {
    failures.push({ where: "v0 non-matching", detail: "expected high" })
  }

  // ─── v0 Multi-facility rebate rollup ────────────────────────────
  const { v0MultiFacilityRebateRollup, v0DedupConfidence } = await import(
    "@/lib/v0-spec/multi-facility"
  )
  // Doc example: $500k + $300k + $200k = $1M → tier 3 (4%) → $40k,
  //              shares 50/30/20 → $20k / $12k / $8k.
  const tiersMulti = [
    { tierNumber: 1, spendMin: 0, spendMax: 500_000, rebateValue: 2 },
    { tierNumber: 2, spendMin: 500_000, spendMax: 1_000_000, rebateValue: 3 },
    { tierNumber: 3, spendMin: 1_000_000, spendMax: null, rebateValue: 4 },
  ]
  const roll = v0MultiFacilityRebateRollup(
    [
      { facilityId: "f1", spend: 500_000 },
      { facilityId: "f2", spend: 300_000 },
      { facilityId: "f3", spend: 200_000 },
    ],
    tiersMulti,
  )
  if (
    !approx(roll.totalRebate, 40_000) ||
    roll.perFacility.length !== 3 ||
    !approx(roll.perFacility[0]!.rebateShare, 20_000) ||
    !approx(roll.perFacility[1]!.rebateShare, 12_000) ||
    !approx(roll.perFacility[2]!.rebateShare, 8_000)
  ) {
    failures.push({ where: "v0 multi-facility rollup", detail: JSON.stringify(roll) })
  }
  const dedup = v0DedupConfidence(
    { inventoryNumber: "INV1", vendorItemNo: "AR-1", vendorName: "A", itemDescription: "x", date: "2025-01-01", poNumber: "PO1" },
    { inventoryNumber: "INV1", vendorItemNo: "AR-1", vendorName: "A", itemDescription: "x", date: "2025-01-01", poNumber: "PO2" },
  )
  if (dedup !== "exact") {
    failures.push({ where: "v0 dedup exact", detail: dedup })
  }

  // ─── v0 Contract performance ────────────────────────────────────
  const { v0RebateUtilization, v0SpendConcentration, v0RenewalRisk } =
    await import("@/lib/v0-spec/contract-performance")
  const util = v0RebateUtilization(75_000, tiersA)
  // actual = $75k × 3% = $2,250; max = $75k × 4% = $3,000; utilization 75%.
  if (!approx(util.utilizationPct, 75)) {
    failures.push({ where: "v0 rebate utilization", detail: JSON.stringify(util) })
  }
  const conc = v0SpendConcentration([
    { vendorId: "a", spend: 40 },
    { vendorId: "b", spend: 30 },
    { vendorId: "c", spend: 20 },
    { vendorId: "d", spend: 10 },
  ])
  // shares 40/30/20/10; HHI = 1600+900+400+100 = 3000 → high.
  if (!approx(conc.hhi, 3_000) || conc.level !== "high") {
    failures.push({ where: "v0 HHI", detail: JSON.stringify(conc) })
  }
  const risk = v0RenewalRisk({
    daysRemaining: 100,
    compliancePct: 90,
    avgPriceVariancePct: 2,
    avgResponseTimeHours: 12,
    rebateUtilizationPct: 80,
    openIssues: 1,
  })
  if (risk.riskLevel !== "low" && risk.riskLevel !== "medium") {
    failures.push({ where: "v0 renewal risk label", detail: risk.riskLevel })
  }

  // ─── v0 Alerts ──────────────────────────────────────────────────
  const {
    v0ExpirationSeverity,
    v0PriceDiscrepancySeverity,
    v0TierApproachingFires,
    v0ComplianceDropFires,
    v0VendorInactiveFires,
    v0TieInAtRiskFires,
  } = await import("@/lib/v0-spec/alerts")
  if (
    v0ExpirationSeverity(5) !== "critical" ||
    v0ExpirationSeverity(10) !== "high" ||
    v0ExpirationSeverity(25) !== "warning" ||
    v0ExpirationSeverity(60) !== "none"
  ) {
    failures.push({ where: "v0 expiration severity", detail: "band mismatch" })
  }
  if (
    v0PriceDiscrepancySeverity(1) !== "none" ||
    v0PriceDiscrepancySeverity(3) !== "warning" ||
    v0PriceDiscrepancySeverity(7) !== "critical"
  ) {
    failures.push({ where: "v0 price disc severity", detail: "band mismatch" })
  }
  if (!v0TierApproachingFires({ currentSpend: 95_000, nextTierMin: 100_000 })) {
    failures.push({ where: "v0 tier approaching", detail: "95k/100k should fire" })
  }
  if (v0TierApproachingFires({ currentSpend: 80_000, nextTierMin: 100_000 })) {
    failures.push({ where: "v0 tier approaching (negative)", detail: "80k/100k shouldn't fire" })
  }
  if (!v0ComplianceDropFires({ currentPct: 82, historicalAvgPct: 90 })) {
    failures.push({ where: "v0 compliance drop", detail: "8pp below should fire" })
  }
  if (!v0VendorInactiveFires(120)) {
    failures.push({ where: "v0 vendor inactive", detail: "120d should fire" })
  }
  if (!v0TieInAtRiskFires([{ projectedSpend: 80, minimumSpend: 100 }])) {
    failures.push({ where: "v0 tie-in at risk", detail: "80/100 should fire" })
  }
}

/* ─────── tie-in persistence + collection-date round-trip ──────────── */

async function tieInAndCollectionDateCheck(
  scenario: Scenario,
  failures: Failure[],
): Promise<void> {
  // Pick the first already-seeded facility/vendor/contract — we tack a
  // tie-in term + tier + rebate onto them under the E2E_<runId>_ prefix
  // so cleanup still sweeps everything.
  const facId = scenario.facilities[0]?.id
  const contractId = scenario.contracts[0]?.id
  if (!facId || !contractId) {
    return // no fixture to piggyback on
  }

  // Seed a tie-in-shaped ContractTerm with one tier. Mirrors exactly the
  // Prisma shape createContract now writes. If the schema ever drifts
  // (FK rename, required field added, etc.) this assertion fails.
  const term = await prisma.contractTerm.create({
    data: {
      contract: { connect: { id: contractId } },
      termName: `E2E_${scenario.runId}_tiein_term`,
      termType: "spend_rebate",
      baselineType: "spend_based",
      effectiveStart: new Date("2026-01-01"),
      effectiveEnd: new Date("2026-12-31"),
      evaluationPeriod: "annual",
      paymentTiming: "quarterly",
      appliesTo: "all_products",
      rebateMethod: "cumulative",
      tiers: {
        create: [
          {
            tierNumber: 1,
            spendMin: 0,
            rebateType: "percent_of_spend",
            rebateValue: 0.03,
          },
        ],
      },
    },
    include: { tiers: true },
  })

  if (term.tiers.length !== 1) {
    failures.push({
      where: "tie-in persistence",
      detail: `expected 1 tier after nested create, got ${term.tiers.length}`,
    })
  }

  const readback = await prisma.contractTerm.findUnique({
    where: { id: term.id },
    include: { tiers: true },
  })
  if (!readback || readback.tiers.length !== 1) {
    failures.push({
      where: "tie-in persistence",
      detail: `term/tier did not round-trip`,
    })
  }

  // Collection-date round-trip: insert an earned Rebate row, then write
  // a collectionDate distinct from the accrual period and assert it
  // readbacks exactly. This is what createContractTransaction does on
  // the collected branch (contract-periods.ts:325).
  const earned = await prisma.rebate.create({
    data: {
      contractId,
      facilityId: facId,
      rebateEarned: 10_000,
      rebateCollected: 0,
      payPeriodStart: new Date("2025-01-01"),
      payPeriodEnd: new Date("2025-03-31"),
      collectionDate: null,
      notes: `E2E_${scenario.runId}_rebate`,
    },
  })
  const COLLECTION_DATE = new Date("2026-04-15")
  await prisma.rebate.update({
    where: { id: earned.id },
    data: {
      rebateCollected: 10_000,
      collectionDate: COLLECTION_DATE,
    },
  })
  const collected = await prisma.rebate.findUnique({ where: { id: earned.id } })
  const got = collected?.collectionDate?.toISOString()
  const want = COLLECTION_DATE.toISOString()
  if (got !== want) {
    failures.push({
      where: "collection-date round-trip",
      detail: `collectionDate mismatch — want ${want}, got ${got}`,
    })
  }

  // ─── Bug 8 — scopedCategoryIds (ContractTerm.categories) round-trip ───
  // The edit page hydrate was missing `scopedCategoryIds: t.categories`,
  // so a user picked a category → saved → reloaded → dropdown blank.
  // Guard: write a term with a specific `categories` array, read back,
  // assert equal. Catches any future schema/column rename and any
  // default-coercion that wipes the array on write.
  const CATEGORY_FIXTURE = ["E2E_cat_alpha", "E2E_cat_beta"]
  const termWithCats = await prisma.contractTerm.create({
    data: {
      contract: { connect: { id: contractId } },
      termName: `E2E_${scenario.runId}_cats_term`,
      termType: "spend_rebate",
      baselineType: "spend_based",
      effectiveStart: new Date("2026-01-01"),
      effectiveEnd: new Date("2026-12-31"),
      evaluationPeriod: "annual",
      appliesTo: "specific_category",
      rebateMethod: "cumulative",
      categories: CATEGORY_FIXTURE,
    },
  })
  const readbackCats = await prisma.contractTerm.findUnique({
    where: { id: termWithCats.id },
    select: { categories: true },
  })
  if (
    !readbackCats ||
    readbackCats.categories.length !== CATEGORY_FIXTURE.length ||
    !CATEGORY_FIXTURE.every((c) => readbackCats.categories.includes(c))
  ) {
    failures.push({
      where: "scopedCategoryIds round-trip",
      detail: `categories mismatch — want ${JSON.stringify(
        CATEGORY_FIXTURE,
      )}, got ${JSON.stringify(readbackCats?.categories)}`,
    })
  }

  // ─── Bug 13 — COG CSV multiplier auto-map ───
  // Charles's "New New New Short.csv" uses the header "Conversion Factor
  // Ordered" for the multiplier. Without the alias widening in
  // `lib/actions/imports/cog-csv-import.ts`, the auto-mapper dropped the
  // column and every row imported as multiplier=1. Guard against
  // regression by importing `localFallbackMap` directly and asserting
  // the mapping resolves for every common header variant.
  const { localFallbackMap } = await import(
    "@/lib/actions/imports/shared"
  )
  const multiplierTarget = [
    {
      key: "multiplier",
      label:
        "Multiplier / Case Pack / Units per Line / Conversion Factor / Conversion Factor Ordered",
      required: false,
    },
  ]
  const headerVariantsThatMustMap = [
    "Conversion Factor Ordered",
    "Conversion Factor",
    "Multiplier",
    "Case Pack",
    "Units per Line",
  ]
  for (const variant of headerVariantsThatMustMap) {
    const m = localFallbackMap([variant], multiplierTarget)
    if (m.multiplier !== variant) {
      failures.push({
        where: "cog-csv multiplier auto-map",
        detail: `header "${variant}" did not map to multiplier (got ${JSON.stringify(m)})`,
      })
    }
  }

  // ─── Bug 16 — Greedy column mapping, no double-assignment ───
  // Charles's 21,377 imported COG rows all had vendorItemNo set to the
  // vendor NAME ("ARTHREX INC") because the old first-match mapper let
  // the single-word "Vendor" header serve both `vendorName` AND
  // `refNumber` (which has label "Catalog / Product Reference / Vendor
  // Item Number"). Result: 0 on-contract matches by item number.
  // Guard by asserting both targets resolve to the correct headers.
  const cogMappingTargets = [
    { key: "vendorName", label: "Vendor / Supplier Name", required: true },
    {
      key: "refNumber",
      label: "Catalog / Product Reference / Vendor Item Number",
      required: false,
    },
  ]
  const realWorldHeaders = [
    "Purchase Order Number",
    "Vendor",
    "Vendor Item Number",
    "Inventory Description",
    "Date Ordered",
  ]
  const resolved = localFallbackMap(realWorldHeaders, cogMappingTargets)
  if (resolved.vendorName !== "Vendor") {
    failures.push({
      where: "cog-csv greedy mapping",
      detail: `vendorName should map to "Vendor", got ${resolved.vendorName}`,
    })
  }
  if (resolved.refNumber !== "Vendor Item Number") {
    failures.push({
      where: "cog-csv greedy mapping",
      detail: `refNumber should map to "Vendor Item Number", got ${resolved.refNumber}`,
    })
  }

  // Cleanup — these rows are under the E2E_<runId>_ prefix through the
  // parent contract, so the main cleanup sweep picks them up, but we
  // nuke them explicitly here so a mid-run crash still tidies.
  await prisma.rebate.deleteMany({
    where: { notes: { startsWith: `E2E_${scenario.runId}_rebate` } },
  })
  await prisma.contractTier.deleteMany({ where: { termId: term.id } })
  await prisma.contractTerm.deleteMany({
    where: { id: { in: [term.id, termWithCats.id] } },
  })
}

/* ───────────────────────────── cleanup ─────────────────────────────── */

async function cleanupRun(scenario: Scenario): Promise<void> {
  // Delete in child→parent order, scoped by runId prefix.
  const facIds = scenario.facilities.map((f) => f.id).filter(Boolean)
  const venIds = scenario.vendors.map((v) => v.id).filter(Boolean)
  const contractIds = scenario.contracts.map((c) => c.id).filter(Boolean)

  await prisma.cOGRecord.deleteMany({
    where: {
      OR: [{ facilityId: { in: facIds } }, { vendorId: { in: venIds } }],
    },
  })
  await prisma.contractPricing.deleteMany({ where: { contractId: { in: contractIds } } })
  await prisma.contractFacility.deleteMany({ where: { contractId: { in: contractIds } } })
  await prisma.contract.deleteMany({ where: { id: { in: contractIds } } })
  await prisma.facility.deleteMany({ where: { id: { in: facIds } } })
  await prisma.vendor.deleteMany({ where: { id: { in: venIds } } })

  // Safety net: wipe any E2E_<runId>_ leftovers (e.g. rows created after plan
  // resolved if any future code paths do so).
  const safetyPrefix = `E2E_${scenario.runId}_`
  await prisma.cOGRecord.deleteMany({
    where: {
      OR: [
        { facility: { name: { startsWith: safetyPrefix } } },
        { vendor: { name: { startsWith: safetyPrefix } } },
      ],
    },
  })
  await prisma.contractPricing.deleteMany({
    where: { contract: { name: { startsWith: safetyPrefix } } },
  })
  await prisma.contractFacility.deleteMany({
    where: { contract: { name: { startsWith: safetyPrefix } } },
  })
  await prisma.contract.deleteMany({ where: { name: { startsWith: safetyPrefix } } })
  await prisma.facility.deleteMany({ where: { name: { startsWith: safetyPrefix } } })
  await prisma.vendor.deleteMany({ where: { name: { startsWith: safetyPrefix } } })
}

/* ──────────────────────────────  main  ─────────────────────────────── */

async function main(): Promise<number> {
  const seed = parseSeedArg()
  console.log(`[e2e] seed=${seed}`)

  await sweepStaleE2E()

  const scenario = buildScenario(seed)
  console.log(
    `[e2e] scenario runId=${scenario.runId} facilities=${scenario.facilities.length} vendors=${scenario.vendors.length} contracts=${scenario.contracts.length} cog=${scenario.cog.length}`,
  )

  const failures: Failure[] = []
  try {
    console.log(`[e2e] seeding DB…`)
    await seedScenario(scenario)

    console.log(`[e2e] running real recompute pipeline…`)
    await runRecompute(scenario)

    // Facility-POV diff
    console.log(`[e2e] facility-pov diff…`)
    const expectedByFacility = oracleByFacility(scenario)
    const actualByFacility = new Map<string, BucketMap>()
    for (const f of scenario.facilities) {
      actualByFacility.set(f.id, await appFacilityAggregates(f.id))
      diffBuckets(`facility[${f.name}]`, expectedByFacility.get(f.id)!, actualByFacility.get(f.id)!, failures)
    }
    printMatrix("Facility-POV ORACLE", expectedByFacility)
    printMatrix("Facility-POV APP", actualByFacility)

    // Vendor-POV diff (per vendor × facility)
    console.log(`[e2e] vendor-pov diff…`)
    const expectedByVF = oracleByVendorFacility(scenario)
    const actualByVF = new Map<string, BucketMap>()
    for (const key of expectedByVF.keys()) {
      const [vendorId, facilityId] = key.split("__") as [string, string]
      const act = await appVendorFacilityAggregates(vendorId, facilityId)
      actualByVF.set(key, act)
      diffBuckets(`vendor[${key.slice(-20)}]`, expectedByVF.get(key)!, act, failures)
    }

    // Cross-view consistency
    console.log(`[e2e] cross-view consistency…`)
    await crossViewConsistency(scenario, failures)

    // Trailing-12mo contract-detail cascade
    console.log(`[e2e] trailing-12mo check…`)
    await trailing12MoCheck(scenario, failures)

    // Oracle now encodes Charles's v0 prototype math as ground truth.
    // Any divergence between tydei's engine and the v0 spec is a bug
    // in tydei, not in the spec. See `lib/v0-spec/rebate-math.ts` and
    // the "docs" directory of the v0 prototype for the source rules.
    console.log(`[e2e] v0-parity checks…`)
    await v0ParityChecks(failures)

    // Charles — tie-in terms/tiers atomic-persistence + collection-date
    // round-trip checks. Regression guards for:
    //  - bug: "terms and tiers for a tie-in don't save on create"
    //  - bug: "collection date entered on a rebate doesn't collect on
    //    that date" (server-side save path)
    // We can't invoke the createContract server action directly from a
    // script (requireFacility() reads HTTP headers), so we insert rows
    // via Prisma using the same shape createContract now writes and
    // assert readback. This catches schema/FK regressions and verifies
    // the shape is round-trip safe; the server-action wiring is covered
    // by type-check + vitest.
    console.log(`[e2e] tie-in persistence + collection-date round-trip…`)
    await tieInAndCollectionDateCheck(scenario, failures)
  } catch (err) {
    console.error(`[e2e] unexpected error:`, err)
    failures.push({ where: "pipeline", detail: String(err) })
  } finally {
    console.log(`[e2e] cleanup…`)
    try {
      await cleanupRun(scenario)
    } catch (cleanupErr) {
      console.error(`[e2e] CLEANUP FAILED — may need manual sweep:`, cleanupErr)
    }
  }

  console.log(`\n═══ SUMMARY ═══`)
  console.log(`seed=${seed} runId=${scenario.runId}`)
  console.log(`facilities=${scenario.facilities.length} vendors=${scenario.vendors.length} contracts=${scenario.contracts.length} cog=${scenario.cog.length}`)
  if (failures.length === 0) {
    console.log(`RESULT: PASS (0 failures)`)
    return 0
  }
  console.log(`RESULT: FAIL (${failures.length} failures)`)
  const MAX_PRINT = 40
  for (const f of failures.slice(0, MAX_PRINT)) {
    console.log(`  ✗ ${f.where}: ${f.detail}`)
  }
  if (failures.length > MAX_PRINT) {
    console.log(`  …and ${failures.length - MAX_PRINT} more`)
  }
  return 1
}

main()
  .then((code) => {
    void prisma.$disconnect().finally(() => process.exit(code))
  })
  .catch((err) => {
    console.error(err)
    void prisma.$disconnect().finally(() => process.exit(1))
  })
