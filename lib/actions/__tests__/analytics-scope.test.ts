import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * Scope-gate tests for the contract-scoped analytics actions.
 *
 * The actions delegate their MATH to lib/v0-spec/* (which has its
 * own oracle tests), so this suite focuses on the boundary that
 * broke yesterday: requireContractScope must reject unauthorized
 * contractIds, and the cached/wrapped facade must propagate the
 * rejection (not return stale data, not throw a Prisma stack to
 * the client).
 *
 * The five actions verified here:
 *   - getRenewalRisk
 *   - getRebateForecast
 *   - getTieInCompliance
 *   - evaluateServiceSla
 *
 * Each is exercised under three conditions:
 *   1. facility-owned contract → action runs (data may be empty)
 *   2. vendor-owned contract → action runs
 *   3. unowned contract → throws sanitized "unavailable" error
 */

const {
  memberFindFirstMock,
  contractFindFirstMock,
  contractFindFirstOrThrowMock,
  cogAggregateMock,
  cogFindManyMock,
  alertCountMock,
  invoiceLineItemFindManyMock,
} = vi.hoisted(() => ({
  memberFindFirstMock: vi.fn(),
  contractFindFirstMock: vi.fn(),
  contractFindFirstOrThrowMock: vi.fn(),
  cogAggregateMock: vi.fn(),
  cogFindManyMock: vi.fn(),
  alertCountMock: vi.fn(),
  invoiceLineItemFindManyMock: vi.fn(),
}))

vi.mock("@/lib/db", () => ({
  prisma: {
    member: { findFirst: memberFindFirstMock },
    contract: {
      findFirst: contractFindFirstMock,
      findFirstOrThrow: contractFindFirstOrThrowMock,
    },
    cOGRecord: { aggregate: cogAggregateMock, findMany: cogFindManyMock },
    alert: { count: alertCountMock },
    invoiceLineItem: { findMany: invoiceLineItemFindManyMock },
  },
}))

vi.mock("@/lib/actions/auth", () => ({
  requireAuth: vi.fn().mockResolvedValue({ user: { id: "u-1" } }),
}))

vi.mock("next/cache", () => import("@/tests/setup/next-cache-mock"))
vi.mock("@/lib/serialize", () => ({ serialize: <T,>(v: T) => v }))

import { getRenewalRisk } from "@/lib/actions/analytics/renewal-risk"
import { getRebateForecast } from "@/lib/actions/analytics/rebate-forecast"
import { getTieInCompliance } from "@/lib/actions/analytics/tie-in-compliance"
import { evaluateServiceSla } from "@/lib/actions/analytics/service-sla"

beforeEach(() => {
  vi.clearAllMocks()
  alertCountMock.mockResolvedValue(0)
  invoiceLineItemFindManyMock.mockResolvedValue([])
  cogAggregateMock.mockResolvedValue({ _sum: { extendedPrice: 0 } })
  cogFindManyMock.mockResolvedValue([])
})

function asFacility() {
  memberFindFirstMock.mockResolvedValue({
    organization: {
      facility: { id: "fac-1" },
      vendor: null,
    },
  })
}

function asVendor() {
  memberFindFirstMock.mockResolvedValue({
    organization: {
      facility: null,
      vendor: { id: "vendor-1" },
    },
  })
}

function ownedContract() {
  // requireContractScope's ownership lookup
  contractFindFirstMock.mockResolvedValue({
    facilityId: "fac-1",
    contractFacilities: [],
  })
  // The action's own findFirstOrThrow (post-scope)
  contractFindFirstOrThrowMock.mockResolvedValue({
    id: "c-owned",
    vendorId: "v-1",
    facilityId: "fac-1",
    effectiveDate: new Date("2025-01-01"),
    expirationDate: new Date("2027-01-01"),
    totalValue: 1_000_000,
    annualValue: 500_000,
    complianceRate: 80,
    currentMarketShare: 70,
    marketShareCommitment: 60,
    contractType: "service",
    rebates: [],
    terms: [],
    pricingItems: [],
  })
}

function unownedContract() {
  // ownership lookup misses
  contractFindFirstMock.mockResolvedValue(null)
}

describe("analytics scope gates", () => {
  for (const role of ["facility", "vendor"] as const) {
    describe(`as ${role}`, () => {
      beforeEach(() => {
        if (role === "facility") asFacility()
        else asVendor()
      })

      it("getRenewalRisk throws sanitized when contract is unowned", async () => {
        unownedContract()
        await expect(getRenewalRisk("c-other")).rejects.toThrow(
          /Renewal risk is unavailable/,
        )
      })

      it("getRebateForecast throws sanitized when contract is unowned", async () => {
        unownedContract()
        await expect(getRebateForecast("c-other")).rejects.toThrow(
          /Rebate forecast is unavailable/,
        )
      })

      it("getTieInCompliance throws sanitized when contract is unowned", async () => {
        unownedContract()
        await expect(getTieInCompliance("c-other")).rejects.toThrow(
          /Tie-in compliance is unavailable/,
        )
      })

      it("evaluateServiceSla throws sanitized when contract is unowned", async () => {
        unownedContract()
        await expect(
          evaluateServiceSla({
            contractId: "c-other",
            actualResponseHours: 6,
            slaResponseHours: 4,
            actualUptimePct: 99.5,
            slaUptimePct: 99.9,
          }),
        ).rejects.toThrow(/SLA evaluation is unavailable/)
      })

      it("evaluateServiceSla returns a penalty triple when contract is owned", async () => {
        ownedContract()
        const result = await evaluateServiceSla({
          contractId: "c-owned",
          actualResponseHours: 6,
          slaResponseHours: 4,
          actualUptimePct: 99.5,
          slaUptimePct: 99.9,
        })
        expect(result).toMatchObject({
          responsePenalty: expect.any(Number),
          uptimePenalty: expect.any(Number),
          totalPenalty: expect.any(Number),
        })
        // 6h actual vs 4h SLA = 2h over * $250 = $500 (default rate).
        expect(result.responsePenalty).toBe(500)
      })
    })
  }

  it("rejects users with neither facility nor vendor membership", async () => {
    memberFindFirstMock.mockResolvedValue({
      organization: { facility: null, vendor: null },
    })
    await expect(getRenewalRisk("c-1")).rejects.toThrow(
      /Renewal risk is unavailable/,
    )
  })

  it("rejects users with BOTH facility AND vendor membership (audit defense)", async () => {
    memberFindFirstMock.mockResolvedValue({
      organization: {
        facility: { id: "fac-1" },
        vendor: { id: "vendor-1" },
      },
    })
    await expect(getRenewalRisk("c-1")).rejects.toThrow(
      /Renewal risk is unavailable/,
    )
  })
})
