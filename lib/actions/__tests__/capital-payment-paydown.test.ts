/**
 * BUG (Charles 2026-06-20): "when I log a payment it does not record or count
 * toward the balance" on a pure CAPITAL contract. Capital contracts earn no
 * rebates — they're paid off by logged payments/credits, which land in
 * ContractPeriod with totalSpend=0 and the amount on paymentActual. This test
 * locks that those logged payments flow into paidToDate / remainingBalance /
 * paymentsAppliedToCapital in getContractCapitalSchedule.
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
  rebates: never[]
  vendorId: string
  terms: never[]
}

let contractRow: ContractRow | null = null
// The amount the user "logged" as a payment (ContractPeriod.paymentActual).
let loggedPaymentSum = 0

vi.mock("@/lib/db", () => ({
  prisma: {
    contract: { findFirst: vi.fn(async () => contractRow) },
    cOGRecord: {
      aggregate: vi.fn(async () => ({ _sum: { extendedPrice: 0 } })),
    },
    contractPeriod: {
      aggregate: vi.fn(async (args: { _sum?: { paymentActual?: boolean } }) => {
        // The logged-payment aggregate asks for _sum.paymentActual; the
        // rolling-12 spend aggregate asks for _sum.totalSpend.
        if (args?._sum?.paymentActual) {
          return { _sum: { paymentActual: loggedPaymentSum } }
        }
        return { _sum: { totalSpend: 0 } }
      }),
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

function capitalContract(): ContractRow {
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
    rebates: [],
    vendorId: "v-test",
    terms: [],
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  contractRow = capitalContract()
  loggedPaymentSum = 0
})

describe("capital payment paydown", () => {
  it("with no payments logged, balance is the full financed principal", async () => {
    const { getContractCapitalSchedule } = await import(
      "@/lib/actions/contracts/tie-in"
    )
    const r = await getContractCapitalSchedule(CONTRACT_ID)
    expect(r.paymentsAppliedToCapital).toBe(0)
    expect(r.paidToDate).toBe(0)
    expect(r.remainingBalance).toBe(CAPITAL)
  })

  it("counts a logged payment toward paidToDate, remainingBalance, and paymentsAppliedToCapital", async () => {
    loggedPaymentSum = 50_000
    const { getContractCapitalSchedule } = await import(
      "@/lib/actions/contracts/tie-in"
    )
    const r = await getContractCapitalSchedule(CONTRACT_ID)
    expect(r.paymentsAppliedToCapital).toBe(50_000)
    // No rebates on a pure capital contract → paidToDate is the payment.
    expect(r.rebateAppliedToCapital).toBe(0)
    expect(r.paidToDate).toBe(50_000)
    expect(r.remainingBalance).toBe(CAPITAL - 50_000)
  })
})
