/**
 * Tests for the pure alert synthesizer (lib/alerts/synthesizer.ts).
 * Covers each rule's create + resolve lifecycle and idempotency.
 */

import { describe, it, expect } from "vitest"
import {
  synthesizeAlertsForFacility,
  OFF_CONTRACT_DOLLAR_THRESHOLD,
  TIER_THRESHOLD_PERCENT,
  type SynthInput,
  type SynthCogRecord,
  type SynthContract,
  type SynthContractPeriod,
  type SynthPaymentSchedule,
  type SynthExistingAlert,
} from "../synthesizer"

const FACILITY = "fac-1"
const NOW = new Date("2026-04-18T00:00:00.000Z")

function baseInput(partial: Partial<SynthInput> = {}): SynthInput {
  return {
    facilityId: FACILITY,
    now: NOW,
    cogRecords: [],
    contracts: [],
    contractPeriods: [],
    paymentSchedules: [],
    existingAlerts: [],
    ...partial,
  }
}

// ─── off_contract ─────────────────────────────────────────────────

describe("synthesizer: off_contract", () => {
  const offRow = (overrides: Partial<SynthCogRecord> = {}): SynthCogRecord => ({
    id: "r-1",
    poNumber: "PO-100",
    vendorId: "vend-1",
    vendorName: "Acme",
    inventoryNumber: "SKU-1",
    inventoryDescription: "Widget",
    unitCost: 600,
    quantity: 1,
    extendedPrice: 600,
    contractPrice: null,
    matchStatus: "off_contract_item",
    transactionDate: new Date("2026-04-10"),
    ...overrides,
  })

  it("creates an alert when vendor exceeds the dollar threshold", () => {
    const input = baseInput({
      cogRecords: [offRow({ id: "r-1", extendedPrice: OFF_CONTRACT_DOLLAR_THRESHOLD + 500 })],
    })
    const { toCreate, toResolve } = synthesizeAlertsForFacility(input)
    expect(toCreate).toHaveLength(1)
    expect(toCreate[0].alertType).toBe("off_contract")
    expect(toCreate[0].vendorId).toBe("vend-1")
    expect(toResolve).toEqual([])
  })

  it("creates one alert per PO when vendor has multiple POs", () => {
    const input = baseInput({
      cogRecords: [
        offRow({ id: "a", poNumber: "PO-100", extendedPrice: 2000 }),
        offRow({ id: "b", poNumber: "PO-200", extendedPrice: 2000 }),
      ],
    })
    const { toCreate } = synthesizeAlertsForFacility(input)
    expect(toCreate).toHaveLength(2)
    const pos = toCreate.map((a) => a.metadata).map((m) => (m as { po_id: string }).po_id)
    expect(pos.sort()).toEqual(["PO-100", "PO-200"])
  })

  it("skips vendors below both thresholds", () => {
    const input = baseInput({
      cogRecords: [offRow({ extendedPrice: 100 })], // 1 item, $100 → under both thresholds
    })
    const { toCreate } = synthesizeAlertsForFacility(input)
    expect(toCreate).toEqual([])
  })

  it("is idempotent when an alert already exists for the same PO", () => {
    const input = baseInput({
      cogRecords: [offRow({ extendedPrice: 5000 })],
      existingAlerts: [
        {
          id: "existing-1",
          alertType: "off_contract",
          contractId: null,
          vendorId: "vend-1",
          metadata: { dedupeKey: "off_contract:vend-1:PO-100" },
          status: "new_alert",
        },
      ],
    })
    const { toCreate, toResolve } = synthesizeAlertsForFacility(input)
    expect(toCreate).toEqual([])
    expect(toResolve).toEqual([])
  })

  it("resolves an existing off_contract alert when the PO no longer appears", () => {
    const input = baseInput({
      cogRecords: [], // nothing off-contract anymore
      existingAlerts: [
        {
          id: "stale-1",
          alertType: "off_contract",
          contractId: null,
          vendorId: "vend-1",
          metadata: { dedupeKey: "off_contract:vend-1:PO-100" },
          status: "new_alert",
        },
      ],
    })
    const { toCreate, toResolve } = synthesizeAlertsForFacility(input)
    expect(toCreate).toEqual([])
    expect(toResolve).toEqual(["stale-1"])
  })
})

// ─── expiring_contract ────────────────────────────────────────────

describe("synthesizer: expiring_contract", () => {
  const contract = (overrides: Partial<SynthContract> = {}): SynthContract => ({
    id: "c-1",
    name: "Acme Supply",
    status: "active",
    expirationDate: new Date("2026-06-01"),
    annualValue: 100000,
    vendorId: "vend-1",
    vendorName: "Acme",
    currentSpend: 0,
    tiers: [],
    ...overrides,
  })

  it("creates when within 90 days of expiration", () => {
    const input = baseInput({ contracts: [contract()] })
    const { toCreate } = synthesizeAlertsForFacility(input)
    expect(toCreate).toHaveLength(1)
    expect(toCreate[0].alertType).toBe("expiring_contract")
    expect((toCreate[0].metadata as { days_until_expiry: number }).days_until_expiry).toBeLessThanOrEqual(90)
  })

  it("uses 'high' severity when within 30 days", () => {
    const input = baseInput({
      contracts: [contract({ expirationDate: new Date("2026-05-01") })],
    })
    const { toCreate } = synthesizeAlertsForFacility(input)
    expect(toCreate[0].severity).toBe("high")
  })

  it("skips when >90 days out", () => {
    const input = baseInput({
      contracts: [contract({ expirationDate: new Date("2027-01-01") })],
    })
    const { toCreate } = synthesizeAlertsForFacility(input)
    expect(toCreate).toEqual([])
  })

  it("skips already-expired contracts", () => {
    const input = baseInput({
      contracts: [contract({ expirationDate: new Date("2026-01-01") })],
    })
    const { toCreate } = synthesizeAlertsForFacility(input)
    expect(toCreate).toEqual([])
  })

  it("skips inactive contracts", () => {
    const input = baseInput({
      contracts: [contract({ status: "draft" })],
    })
    const { toCreate } = synthesizeAlertsForFacility(input)
    expect(toCreate).toEqual([])
  })

  it("resolves when the contract is no longer expiring soon", () => {
    const input = baseInput({
      contracts: [],
      existingAlerts: [
        {
          id: "exp-1",
          alertType: "expiring_contract",
          contractId: "c-1",
          vendorId: "vend-1",
          metadata: { dedupeKey: "expiring_contract:c-1" },
          status: "new_alert",
        },
      ],
    })
    const { toResolve } = synthesizeAlertsForFacility(input)
    expect(toResolve).toEqual(["exp-1"])
  })
})

// ─── tier_threshold ──────────────────────────────────────────────

describe("synthesizer: tier_threshold", () => {
  const c = (overrides: Partial<SynthContract> = {}): SynthContract => ({
    id: "c-2",
    name: "Bulk Supply",
    status: "active",
    expirationDate: new Date("2027-01-01"),
    annualValue: 500000,
    vendorId: "vend-2",
    vendorName: "Bulk",
    currentSpend: 85000,
    tiers: [
      { tierNumber: 1, spendMin: 50000, spendMax: 99999, rebateValue: 0.02 },
      { tierNumber: 2, spendMin: 100000, spendMax: null, rebateValue: 0.03 },
    ],
    ...overrides,
  })

  it("creates when within the configured percent of the next tier", () => {
    // 85k of 100k → 15% gap — within 20%
    const input = baseInput({ contracts: [c()] })
    const { toCreate } = synthesizeAlertsForFacility(input)
    expect(toCreate).toHaveLength(1)
    expect(toCreate[0].alertType).toBe("tier_threshold")
    const meta = toCreate[0].metadata as { target_tier: number; amount_needed: number }
    expect(meta.target_tier).toBe(2)
    expect(meta.amount_needed).toBe(15000)
  })

  it("skips when the gap exceeds the threshold percent", () => {
    // 50k of 100k = 50% gap
    const input = baseInput({ contracts: [c({ currentSpend: 50000 })] })
    const { toCreate } = synthesizeAlertsForFacility(input)
    // The configured threshold must NOT treat this as "close enough".
    expect(TIER_THRESHOLD_PERCENT).toBeLessThan(0.5)
    expect(toCreate).toEqual([])
  })

  it("skips when already past the top tier", () => {
    const input = baseInput({
      contracts: [c({ currentSpend: 200000 })],
    })
    const { toCreate } = synthesizeAlertsForFacility(input)
    expect(toCreate).toEqual([])
  })

  it("resolves an existing tier alert when spend now exceeds the tier", () => {
    const input = baseInput({
      contracts: [c({ currentSpend: 110000 })], // already past tier 2
      existingAlerts: [
        {
          id: "tier-1",
          alertType: "tier_threshold",
          contractId: "c-2",
          vendorId: "vend-2",
          metadata: { dedupeKey: "tier_threshold:c-2:2" },
          status: "new_alert",
        },
      ],
    })
    const { toCreate, toResolve } = synthesizeAlertsForFacility(input)
    expect(toCreate).toEqual([])
    expect(toResolve).toEqual(["tier-1"])
  })
})

// ─── rebate_due ──────────────────────────────────────────────────

describe("synthesizer: rebate_due", () => {
  const period = (overrides: Partial<SynthContractPeriod> = {}): SynthContractPeriod => ({
    id: "p-1",
    contractId: "c-3",
    contractName: "Acme Q1",
    vendorId: "vend-3",
    vendorName: "Acme",
    periodStart: new Date("2026-01-01"),
    periodEnd: new Date("2026-03-31"),
    rebateEarned: 5000,
    rebateCollected: 0,
    ...overrides,
  })

  it("creates when a closed period has unpaid rebate", () => {
    const input = baseInput({ contractPeriods: [period()] })
    const { toCreate } = synthesizeAlertsForFacility(input)
    expect(toCreate).toHaveLength(1)
    expect(toCreate[0].alertType).toBe("rebate_due")
    expect((toCreate[0].metadata as { amount: number }).amount).toBe(5000)
  })

  it("skips when rebateCollected >= rebateEarned", () => {
    const input = baseInput({
      contractPeriods: [period({ rebateCollected: 5000 })],
    })
    const { toCreate } = synthesizeAlertsForFacility(input)
    expect(toCreate).toEqual([])
  })

  it("skips when the period has not ended yet", () => {
    const input = baseInput({
      contractPeriods: [
        period({ periodEnd: new Date("2026-12-31") }),
      ],
    })
    const { toCreate } = synthesizeAlertsForFacility(input)
    expect(toCreate).toEqual([])
  })

  it("resolves when the rebate is now collected", () => {
    const input = baseInput({
      contractPeriods: [period({ rebateCollected: 5000 })],
      existingAlerts: [
        {
          id: "reb-1",
          alertType: "rebate_due",
          contractId: "c-3",
          vendorId: "vend-3",
          metadata: { dedupeKey: "rebate_due:c-3:p-1" },
          status: "new_alert",
        },
      ],
    })
    const { toResolve } = synthesizeAlertsForFacility(input)
    expect(toResolve).toEqual(["reb-1"])
  })
})

// ─── payment_due ─────────────────────────────────────────────────

describe("synthesizer: payment_due", () => {
  const sched = (overrides: Partial<SynthPaymentSchedule> = {}): SynthPaymentSchedule => ({
    id: "s-1",
    contractId: "cap-1",
    contractName: "MRI Capital",
    vendorId: "vend-4",
    vendorName: "Imaging Corp",
    amount: 25000,
    dueDate: new Date("2026-04-25"), // 7 days from NOW
    paidAt: null,
    ...overrides,
  })

  it("creates an alert within the lead window", () => {
    const input = baseInput({ paymentSchedules: [sched()] })
    const { toCreate } = synthesizeAlertsForFacility(input)
    expect(toCreate).toHaveLength(1)
    expect(toCreate[0].alertType).toBe("payment_due")
  })

  it("marks past-due as high severity", () => {
    const input = baseInput({
      paymentSchedules: [sched({ dueDate: new Date("2026-04-10") })],
    })
    const { toCreate } = synthesizeAlertsForFacility(input)
    expect(toCreate[0].severity).toBe("high")
    expect(toCreate[0].title).toMatch(/past due/i)
  })

  it("skips fully-paid payments", () => {
    const input = baseInput({
      paymentSchedules: [sched({ paidAt: new Date("2026-04-15") })],
    })
    const { toCreate } = synthesizeAlertsForFacility(input)
    expect(toCreate).toEqual([])
  })

  it("skips payments too far in the future", () => {
    const input = baseInput({
      paymentSchedules: [sched({ dueDate: new Date("2026-12-01") })],
    })
    const { toCreate } = synthesizeAlertsForFacility(input)
    expect(toCreate).toEqual([])
  })
})

// ─── Whole-engine behavior ───────────────────────────────────────

describe("synthesizer: whole engine", () => {
  it("is idempotent — running twice with the same state produces the same deltas", () => {
    const input = baseInput({
      cogRecords: [
        {
          id: "r1",
          poNumber: "PO-A",
          vendorId: "v1",
          vendorName: "V1",
          inventoryNumber: "SKU",
          inventoryDescription: "item",
          unitCost: 5000,
          quantity: 1,
          extendedPrice: 5000,
          contractPrice: null,
          matchStatus: "off_contract_item",
          transactionDate: new Date("2026-04-15"),
        },
      ],
      contracts: [
        {
          id: "c-exp",
          name: "Exp Contract",
          status: "active",
          expirationDate: new Date("2026-05-15"),
          annualValue: 10000,
          vendorId: "v2",
          vendorName: "V2",
          currentSpend: 0,
          tiers: [],
        },
      ],
    })

    const first = synthesizeAlertsForFacility(input)
    expect(first.toCreate.length).toBeGreaterThan(0)

    // Simulate those alerts now being persisted → pass them back in.
    const existingAlerts: SynthExistingAlert[] = first.toCreate.map((a, i) => ({
      id: `new-${i}`,
      alertType: a.alertType,
      contractId: a.contractId ?? null,
      vendorId: a.vendorId ?? null,
      metadata: a.metadata,
      status: "new_alert",
    }))
    const second = synthesizeAlertsForFacility({ ...input, existingAlerts })
    expect(second.toCreate).toEqual([])
    expect(second.toResolve).toEqual([])
  })

  it("ignores existing alerts that don't carry a dedupeKey (legacy)", () => {
    const input = baseInput({
      existingAlerts: [
        {
          id: "legacy-1",
          alertType: "off_contract",
          contractId: null,
          vendorId: "v1",
          metadata: { somethingElse: true },
          status: "new_alert",
        },
      ],
    })
    const { toResolve } = synthesizeAlertsForFacility(input)
    expect(toResolve).toEqual([])
  })
})
