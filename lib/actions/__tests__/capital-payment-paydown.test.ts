/**
 * BUG (Charles 2026-06-20): "credit not recording against the balance" on a
 * pure CAPITAL contract. Capital contracts earn no rebates — they're paid off
 * by logged payments/credits, now stored in the dedicated Payment/Credit
 * tables (contract.payments / contract.creditEntries). These tests lock that:
 *   1. logged payments + credits flow into paidToDate / remainingBalance /
 *      paymentsAppliedToCapital when there IS a financing schedule, and
 *   2. a pure capital contract with NO line items (cost = totalValue) still
 *      produces a balance that payments/credits pay down (the user's case).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

interface ContractRow {
  id: string
  name: string
  contractType: string
  effectiveDate: Date
  facilityId: string
  amortizationShape: string
  amortizationRows: never[]
  performancePeriod: string | null
  rebatePayPeriod: string | null
  capitalLineItems: Array<Record<string, unknown>>
  totalValue: number
  payments: Array<{ paymentAmount: number }>
  creditEntries: Array<{ creditAmount: number }>
  rebates: never[]
  vendorId: string
  terms: never[]
}

let contractRow: ContractRow | null = null

vi.mock("@/lib/db", () => ({
  prisma: {
    contract: { findFirst: vi.fn(async () => contractRow) },
    cOGRecord: {
      aggregate: vi.fn(async () => ({ _sum: { extendedPrice: 0 } })),
    },
    contractPeriod: {
      aggregate: vi.fn(async () => ({ _sum: { totalSpend: 0 } })),
    },
    rebate: { findMany: vi.fn(async () => []) },
  },
}))

vi.mock("@/lib/actions/auth", () => ({
  requireFacility: vi.fn(async () => ({
    facility: { id: "fac-test" },
    user: { id: "user-test" },
  })),
}))
vi.mock("@/lib/actions/contracts-auth", () => ({
  contractOwnershipWhere: vi.fn((id: string) => ({ id })),
  contractsOwnedByFacility: vi.fn(() => ({})),
  facilityScopeClause: vi.fn(() => ({})),
}))
vi.mock("@/lib/serialize", () => ({ serialize: <T,>(x: T) => x }))

const CONTRACT_ID = "cap-1"
const CAPITAL = 200_000

function baseContract(): ContractRow {
  return {
    id: CONTRACT_ID,
    name: "Capital",
    contractType: "capital",
    effectiveDate: new Date("2024-01-01"),
    facilityId: "fac-test",
    amortizationShape: "symmetric",
    amortizationRows: [],
    performancePeriod: "quarterly",
    rebatePayPeriod: "quarterly",
    capitalLineItems: [
      {
        id: "li-1",
        contractId: CONTRACT_ID,
        description: "Capital Equipment",
        itemNumber: null,
        serialNumber: null,
        contractTotal: CAPITAL,
        initialSales: 0,
        interestRate: 0, // zero-interest → financedPrincipal === CAPITAL
        termMonths: 60,
        paymentType: "fixed",
        paymentCadence: "quarterly",
      },
    ],
    totalValue: CAPITAL,
    payments: [],
    creditEntries: [],
    rebates: [],
    vendorId: "v-test",
    terms: [],
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  contractRow = baseContract()
})

describe("capital payment paydown (with financing schedule)", () => {
  it("with no payments logged, balance is the full financed principal", async () => {
    const { getContractCapitalSchedule } = await import(
      "@/lib/actions/contracts/tie-in"
    )
    const r = await getContractCapitalSchedule(CONTRACT_ID)
    expect(r.paymentsAppliedToCapital).toBe(0)
    expect(r.paidToDate).toBe(0)
    expect(r.remainingBalance).toBe(CAPITAL)
  })

  it("counts logged payments AND credits toward paidToDate / remainingBalance", async () => {
    contractRow!.payments = [{ paymentAmount: 30_000 }]
    contractRow!.creditEntries = [{ creditAmount: 20_000 }]
    const { getContractCapitalSchedule } = await import(
      "@/lib/actions/contracts/tie-in"
    )
    const r = await getContractCapitalSchedule(CONTRACT_ID)
    expect(r.paymentsAppliedToCapital).toBe(50_000) // 30k payment + 20k credit
    expect(r.rebateAppliedToCapital).toBe(0)
    expect(r.paidToDate).toBe(50_000)
    expect(r.remainingBalance).toBe(CAPITAL - 50_000)
  })
})

describe("capital balance with NO line items (cost = totalValue) — the user's case", () => {
  beforeEach(() => {
    contractRow = baseContract()
    contractRow.capitalLineItems = [] // pure capital contract, no financing schedule
  })

  it("derives the balance from totalValue and pays it down with credits", async () => {
    contractRow!.creditEntries = [{ creditAmount: 75_000 }]
    const { getContractCapitalSchedule } = await import(
      "@/lib/actions/contracts/tie-in"
    )
    const r = await getContractCapitalSchedule(CONTRACT_ID)
    expect(r.hasSchedule).toBe(false)
    expect(r.capitalCost).toBe(CAPITAL) // from totalValue
    expect(r.paymentsAppliedToCapital).toBe(75_000)
    expect(r.paidToDate).toBe(75_000)
    expect(r.remainingBalance).toBe(CAPITAL - 75_000)
  })

  it("a usage contract with no line items still returns empty (no capital balance)", async () => {
    contractRow!.contractType = "usage"
    contractRow!.creditEntries = [{ creditAmount: 75_000 }]
    const { getContractCapitalSchedule } = await import(
      "@/lib/actions/contracts/tie-in"
    )
    const r = await getContractCapitalSchedule(CONTRACT_ID)
    expect(r.capitalCost).toBe(0)
    expect(r.hasSchedule).toBe(false)
  })
})
