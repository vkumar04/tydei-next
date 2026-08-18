import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * Approving a proposal with pricing must actually WRITE the prices.
 *
 * The trap this guards: `extractContractUpdateData` returns null for
 * term_change / new_term / remove_term, so approving those mutates nothing and
 * is documented as advisory. A reviewer clicking Approve on a price list has
 * every reason to believe prices changed — proposed pricing must not become the
 * second silently-advisory payload.
 */

const {
  proposalFindUniqueOrThrowMock,
  proposalUpdateMock,
  contractUpdateMock,
  pricingFindManyMock,
  pricingUpdateMock,
  pricingCreateManyMock,
  transactionMock,
  requireFacilityMock,
  recomputeMock,
  logAuditMock,
} = vi.hoisted(() => {
  const proposalUpdate = vi.fn()
  const contractUpdate = vi.fn()
  const pricingUpdate = vi.fn()
  const pricingCreateMany = vi.fn()
  return {
    proposalFindUniqueOrThrowMock: vi.fn(),
    proposalUpdateMock: proposalUpdate,
    contractUpdateMock: contractUpdate,
    pricingFindManyMock: vi.fn(),
    pricingUpdateMock: pricingUpdate,
    pricingCreateManyMock: pricingCreateMany,
    transactionMock: vi.fn(async (fn: (tx: unknown) => Promise<void>) =>
      fn({
        contract: { update: contractUpdate },
        contractPricing: { update: pricingUpdate, createMany: pricingCreateMany },
        contractChangeProposal: { update: proposalUpdate },
      }),
    ),
    requireFacilityMock: vi.fn(),
    recomputeMock: vi.fn(),
    logAuditMock: vi.fn(),
  }
})

vi.mock("@/lib/db", () => ({
  prisma: {
    contractChangeProposal: {
      findUniqueOrThrow: proposalFindUniqueOrThrowMock,
      update: proposalUpdateMock,
    },
    contractPricing: { findMany: pricingFindManyMock },
    vendor: { findUnique: vi.fn().mockResolvedValue(null) },
    $transaction: transactionMock,
  },
}))
vi.mock("@/lib/actions/auth", () => ({ requireFacility: requireFacilityMock }))
vi.mock("@/lib/actions/auth-permissions", () => ({
  requireCanMutate: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("@/lib/audit", () => ({ logAudit: logAuditMock }))
vi.mock("@/lib/serialize", () => ({ serialize: <T,>(v: T) => v }))
vi.mock("@/lib/cog/recompute", () => ({
  recomputeMatchStatusesForVendor: recomputeMock,
}))

import { approveContractChangeProposal } from "@/lib/actions/contracts/proposals"

const PROPOSAL = {
  id: "prop-1",
  contractId: "c-1",
  vendorId: "v-1",
  status: "pending",
  proposalType: "term_change",
  changes: [],
  proposedTerms: {
    pricingItems: [
      { vendorItemNo: "ABC-100", description: "Knee stem", unitPrice: 1_100 },
      { vendorItemNo: "NEW-9", description: "New widget", unitPrice: 75, category: "Implants" },
      { vendorItemNo: "SAME-1", unitPrice: 500 },
    ],
  },
  contract: { id: "c-1", facilityId: "f-1" },
}

beforeEach(() => {
  vi.clearAllMocks()
  requireFacilityMock.mockResolvedValue({
    facility: { id: "f-1" },
    user: { id: "u-1" },
  })
  proposalFindUniqueOrThrowMock.mockResolvedValue(PROPOSAL)
  pricingFindManyMock.mockResolvedValue([
    { id: "e1", vendorItemNo: "ABC-100", description: "Knee stem", category: "Implants", unitPrice: 1_000 },
    { id: "e2", vendorItemNo: "SAME-1", description: null, category: null, unitPrice: 500 },
  ])
})

describe("approveContractChangeProposal — proposed pricing", () => {
  it("REGRESSION: applies the prices instead of only flipping status", async () => {
    await approveContractChangeProposal("prop-1")

    // The reprice lands on the matched row.
    expect(pricingUpdateMock).toHaveBeenCalledTimes(1)
    const upd = pricingUpdateMock.mock.calls[0]![0] as {
      where: { id: string }
      data: { unitPrice: number }
    }
    expect(upd.where.id).toBe("e1")
    expect(upd.data.unitPrice).toBe(1_100)

    // The genuinely new SKU is created; the unchanged one is not.
    expect(pricingCreateManyMock).toHaveBeenCalledTimes(1)
    const created = pricingCreateManyMock.mock.calls[0]![0] as {
      data: { vendorItemNo: string; contractId: string; uom: string }[]
    }
    expect(created.data).toHaveLength(1)
    expect(created.data[0]!.vendorItemNo).toBe("NEW-9")
    expect(created.data[0]!.contractId).toBe("c-1")
    expect(created.data[0]!.uom).toBe("EA")
  })

  it("writes pricing inside the same transaction as the status flip", async () => {
    await approveContractChangeProposal("prop-1")
    expect(transactionMock).toHaveBeenCalledTimes(1)
    // Both the pricing writes and the status flip used the `tx` client.
    expect(pricingUpdateMock).toHaveBeenCalled()
    expect(proposalUpdateMock).toHaveBeenCalled()
  })

  it("recomputes COG match statuses, since contract prices moved", async () => {
    await approveContractChangeProposal("prop-1")
    expect(recomputeMock).toHaveBeenCalledWith("v-1", "f-1")
  })

  it("does not recompute when nothing was added or repriced", async () => {
    proposalFindUniqueOrThrowMock.mockResolvedValue({
      ...PROPOSAL,
      proposedTerms: { pricingItems: [{ vendorItemNo: "SAME-1", unitPrice: 500 }] },
    })
    await approveContractChangeProposal("prop-1")
    expect(pricingUpdateMock).not.toHaveBeenCalled()
    expect(pricingCreateManyMock).not.toHaveBeenCalled()
    expect(recomputeMock).not.toHaveBeenCalled()
  })

  it("a failed recompute does not fail the approval", async () => {
    recomputeMock.mockRejectedValue(new Error("cog exploded"))
    await expect(approveContractChangeProposal("prop-1")).resolves.toBeUndefined()
    expect(proposalUpdateMock).toHaveBeenCalled()
  })

  it("skips pricing work entirely when the proposal carries none", async () => {
    proposalFindUniqueOrThrowMock.mockResolvedValue({
      ...PROPOSAL,
      proposedTerms: null,
    })
    await approveContractChangeProposal("prop-1")
    expect(pricingFindManyMock).not.toHaveBeenCalled()
    expect(pricingUpdateMock).not.toHaveBeenCalled()
    expect(proposalUpdateMock).toHaveBeenCalled()
  })

  it("ignores a malformed proposedTerms blob rather than throwing mid-approval", async () => {
    proposalFindUniqueOrThrowMock.mockResolvedValue({
      ...PROPOSAL,
      proposedTerms: { pricingItems: "not-an-array" },
    })
    await expect(approveContractChangeProposal("prop-1")).resolves.toBeUndefined()
    expect(pricingUpdateMock).not.toHaveBeenCalled()
    expect(proposalUpdateMock).toHaveBeenCalled()
  })

  it("refuses a proposal belonging to another facility", async () => {
    proposalFindUniqueOrThrowMock.mockResolvedValue({
      ...PROPOSAL,
      contract: { id: "c-1", facilityId: "other-facility" },
    })
    await expect(approveContractChangeProposal("prop-1")).rejects.toThrow(
      /different facility/i,
    )
    expect(pricingUpdateMock).not.toHaveBeenCalled()
    expect(transactionMock).not.toHaveBeenCalled()
  })
})
