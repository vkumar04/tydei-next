import { describe, it, expect, vi, beforeEach } from "vitest"

const {
  findManyMock,
  findUniqueOrThrowMock,
  proposalUpdateMock,
  contractUpdateMock,
  txProposalUpdateMock,
  transactionMock,
} = vi.hoisted(() => {
  const contractUpdate = vi.fn().mockResolvedValue({})
  const txProposalUpdate = vi.fn().mockResolvedValue({})
  return {
    findManyMock: vi.fn(),
    findUniqueOrThrowMock: vi.fn(),
    proposalUpdateMock: vi.fn().mockResolvedValue({}),
    contractUpdateMock: contractUpdate,
    txProposalUpdateMock: txProposalUpdate,
    transactionMock: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
      cb({
        contract: { update: contractUpdate },
        contractChangeProposal: { update: txProposalUpdate },
      }),
    ),
  }
})

vi.mock("@/lib/db", () => ({
  prisma: {
    contractChangeProposal: {
      findMany: findManyMock,
      findUniqueOrThrow: findUniqueOrThrowMock,
      update: proposalUpdateMock,
    },
    $transaction: transactionMock,
  },
}))

vi.mock("@/lib/actions/auth", () => ({
  requireFacility: vi.fn().mockResolvedValue({
    facility: { id: "fac-1" },
    user: { id: "u-1" },
  }),
}))

vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }))

import {
  getPendingProposalsForContract,
  approveContractChangeProposal,
  rejectContractChangeProposal,
  requestProposalRevision,
} from "@/lib/actions/contracts/proposals"

beforeEach(() => {
  vi.clearAllMocks()
})

describe("contract change proposals", () => {
  it("getPendingProposalsForContract filters by contract and pending status", async () => {
    findManyMock.mockResolvedValue([])
    await getPendingProposalsForContract("c-1")
    const where = findManyMock.mock.calls[0][0].where
    expect(where.contractId).toBe("c-1")
    expect(where.status).toBe("pending")
  })

  it("approve flips status + applies changes via transaction", async () => {
    findUniqueOrThrowMock.mockResolvedValue({
      id: "p-1",
      contractId: "c-1",
      status: "pending",
      proposedTerms: { totalValue: 500000 },
      changes: [],
      contract: { id: "c-1", facilityId: "fac-1" },
    })
    await approveContractChangeProposal("p-1")
    expect(transactionMock).toHaveBeenCalled()
    expect(txProposalUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "p-1" },
        data: expect.objectContaining({ status: "approved" }),
      }),
    )
  })

  it("reject flips status to rejected with notes", async () => {
    findUniqueOrThrowMock.mockResolvedValue({
      id: "p-1",
      status: "pending",
      contract: { facilityId: "fac-1" },
    })
    await rejectContractChangeProposal("p-1", "Pricing too high")
    expect(proposalUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "p-1" },
        data: expect.objectContaining({
          status: "rejected",
          reviewNotes: "Pricing too high",
        }),
      }),
    )
  })

  it("requestRevision flips status to revision_requested with notes", async () => {
    findUniqueOrThrowMock.mockResolvedValue({
      id: "p-1",
      status: "pending",
      contract: { facilityId: "fac-1" },
    })
    await requestProposalRevision("p-1", "Add detail on tier 2")
    expect(proposalUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "p-1" },
        data: expect.objectContaining({
          status: "revision_requested",
          reviewNotes: "Add detail on tier 2",
        }),
      }),
    )
  })
})
