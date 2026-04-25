import { describe, it, expect, vi, beforeEach } from "vitest"

const {
  findUniqueOrThrowMock,
  contractUpdateMock,
  txProposalUpdateMock,
  transactionMock,
} = vi.hoisted(() => {
  const contractUpdate = vi.fn().mockResolvedValue({})
  const txProposalUpdate = vi.fn().mockResolvedValue({})
  return {
    findUniqueOrThrowMock: vi.fn(),
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
      findUniqueOrThrow: findUniqueOrThrowMock,
    },
    vendor: { findUnique: vi.fn().mockResolvedValue(null) },
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

import { approveContractChangeProposal } from "@/lib/actions/contracts/proposals"

beforeEach(() => {
  vi.clearAllMocks()
})

describe("approveContractChangeProposal — extractContractUpdateData", () => {
  function setProposal(changes: unknown) {
    findUniqueOrThrowMock.mockResolvedValue({
      id: "p-1",
      contractId: "c-1",
      vendorId: "v-1",
      status: "pending",
      proposalType: "contract_edit",
      changes,
      contract: { id: "c-1", facilityId: "fac-1" },
    })
  }

  it("applies vendor-style payload {field, proposedValue}", async () => {
    setProposal([
      { field: "name", currentValue: "Old", proposedValue: "New Name" },
    ])
    await approveContractChangeProposal("p-1")
    expect(contractUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "c-1" },
        data: expect.objectContaining({ name: "New Name" }),
      }),
    )
  })

  it("falls back to {field, newValue} for older payloads", async () => {
    setProposal([{ field: "name", newValue: "Legacy Name" }])
    await approveContractChangeProposal("p-1")
    expect(contractUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ name: "Legacy Name" }),
      }),
    )
  })

  it("applies a date field — effectiveDate is coerced to a Date", async () => {
    setProposal([
      { field: "effectiveDate", proposedValue: "2026-06-01" },
    ])
    await approveContractChangeProposal("p-1")
    const call = contractUpdateMock.mock.calls[0][0]
    expect(call.data.effectiveDate).toBeInstanceOf(Date)
    expect((call.data.effectiveDate as Date).toISOString().slice(0, 10)).toBe(
      "2026-06-01",
    )
  })

  it("applies a Phase-2 field — gpoAffiliation", async () => {
    setProposal([
      { field: "gpoAffiliation", proposedValue: "Vizient" },
    ])
    await approveContractChangeProposal("p-1")
    expect(contractUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ gpoAffiliation: "Vizient" }),
      }),
    )
  })

  it("drops non-whitelisted fields", async () => {
    setProposal([
      { field: "facilityId", proposedValue: "fac-evil" },
      { field: "id", proposedValue: "c-evil" },
      // include one valid field so the patch is non-empty and update fires
      { field: "name", proposedValue: "Real Update" },
    ])
    await approveContractChangeProposal("p-1")
    const data = contractUpdateMock.mock.calls[0][0].data
    expect(data).toEqual({ name: "Real Update" })
    expect(data.facilityId).toBeUndefined()
    expect(data.id).toBeUndefined()
  })

  it("skips contract.update when nothing whitelisted is present", async () => {
    setProposal([{ field: "facilityId", proposedValue: "fac-evil" }])
    await approveContractChangeProposal("p-1")
    expect(contractUpdateMock).not.toHaveBeenCalled()
    expect(txProposalUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "approved" }),
      }),
    )
  })
})
