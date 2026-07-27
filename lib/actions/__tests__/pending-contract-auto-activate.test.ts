/**
 * One-way auto-activation in `createPendingContract`
 * (Charles 2026-07-27: "if it is set up for 1 way on a facility it does not
 * need to submit a contract it just becomes active after creating it").
 *
 * Before this, the row was hardcoded `status: "submitted"` and the only exit
 * into a live Contract was `approvePendingContract`, which opens with
 * `requireFacility()`. A one-way vendor has no counterparty facility user, so
 * its submissions sat at "submitted" forever — the stranded Stryker Flex
 * Financial / "2 LSC" row in the report.
 *
 * What this pins:
 *  1. one-way + a facility the vendor is connected to → materializes NOW
 *     (live Contract, pending row flipped to approved, reviewedBy = the
 *     VENDOR's own user, no "please review" email — nobody is reviewing).
 *  2. `canAutoActivate` false → the old submit-for-review path is byte-for-
 *     byte intact (no Contract written, notification still sent). This is the
 *     cross-tenant case: a client-supplied facilityId the vendor has no
 *     accepted Connection with must NEVER mint a live contract.
 *  3. standalone (no facility) → the Contract is the vendor's OWN
 *     (facilityId null) and the facility-scoped COG recompute is skipped.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const {
  pendingCreateMock,
  pendingFindUniqueOrThrowMock,
  txPendingUpdateMock,
  facilityFindUniqueMock,
  contractCreateMock,
  contractFindUniqueMock,
  transactionMock,
  requireVendorMock,
  requireCanMutateMock,
  resolveOperatingModeMock,
  canAutoActivateMock,
  notifyFacilityMock,
  notifyVendorDecisionMock,
  recomputeMock,
  revalidatePathMock,
} = vi.hoisted(() => ({
  pendingCreateMock: vi.fn(),
  pendingFindUniqueOrThrowMock: vi.fn(),
  txPendingUpdateMock: vi.fn(),
  facilityFindUniqueMock: vi.fn(),
  contractCreateMock: vi.fn(),
  contractFindUniqueMock: vi.fn(),
  transactionMock: vi.fn(),
  requireVendorMock: vi.fn(),
  requireCanMutateMock: vi.fn(),
  resolveOperatingModeMock: vi.fn(),
  canAutoActivateMock: vi.fn(),
  notifyFacilityMock: vi.fn(),
  notifyVendorDecisionMock: vi.fn(),
  recomputeMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}))

vi.mock("@/lib/db", () => ({
  prisma: {
    pendingContract: {
      create: pendingCreateMock,
      findUniqueOrThrow: pendingFindUniqueOrThrowMock,
    },
    facility: { findUnique: facilityFindUniqueMock },
    contract: { findUnique: contractFindUniqueMock },
    $transaction: transactionMock,
  },
}))

vi.mock("@/lib/actions/auth", () => ({
  requireVendor: requireVendorMock,
  requireFacility: vi.fn(),
}))
vi.mock("@/lib/actions/auth-permissions", () => ({
  requireCanMutate: requireCanMutateMock,
}))
vi.mock("@/lib/connections/operating-mode", () => ({
  resolveOperatingMode: resolveOperatingModeMock,
  canAutoActivate: canAutoActivateMock,
}))
vi.mock("@/lib/actions/notifications", () => ({
  notifyFacilityOfPendingContract: notifyFacilityMock,
  notifyVendorOfPendingDecision: notifyVendorDecisionMock,
}))
vi.mock("@/lib/cog/recompute", () => ({
  recomputeMatchStatusesForVendor: recomputeMock,
}))
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }))
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }))

import * as pendingContractActions from "@/lib/actions/pending-contracts"
import { createPendingContract } from "@/lib/actions/pending-contracts"
import type { CreatePendingContractInput } from "@/lib/validators/pending-contracts"

/** Minimum payload the create schema accepts. */
function payload(
  over: Partial<CreatePendingContractInput> = {},
): CreatePendingContractInput {
  return {
    vendorId: "ven-1",
    vendorName: "Stryker",
    contractName: "Flex Financial",
    contractType: "capital",
    ...over,
  }
}

/** The PendingContract row prisma.create returns, as the action sees it. */
function pendingRow(over: Record<string, unknown> = {}) {
  return {
    id: "pend-1",
    vendorId: "ven-1",
    vendorName: "Stryker",
    facilityId: null,
    facilityName: null,
    contractName: "Flex Financial",
    contractType: "capital",
    status: "submitted",
    effectiveDate: null,
    expirationDate: null,
    totalValue: null,
    autoRenewal: false,
    terminationNoticeDays: null,
    capitalCost: null,
    downPayment: null,
    interestRate: null,
    termMonths: null,
    paymentCadence: null,
    amortizationShape: null,
    capitalLineItems: null,
    tieInContractId: null,
    division: null,
    terms: [],
    documents: [],
    pricingData: null,
    notes: null,
    contractNumber: null,
    annualValue: null,
    gpoAffiliation: null,
    performancePeriod: null,
    rebatePayPeriod: null,
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  requireVendorMock.mockResolvedValue({
    vendor: { id: "ven-1", name: "Stryker" },
    user: { id: "vendor-user-1" },
  })
  requireCanMutateMock.mockResolvedValue(undefined)
  // The flip is an updateMany compare-and-swap; materializePending throws
  // unless exactly one row moved.
  txPendingUpdateMock.mockResolvedValue({ count: 1 })
  facilityFindUniqueMock.mockResolvedValue({ name: "Lighthouse Surgical Center" })
  contractCreateMock.mockResolvedValue({ id: "contract-1" })
  contractFindUniqueMock.mockResolvedValue({
    id: "contract-1",
    vendorId: "ven-1",
    facilityId: null,
  })
  notifyVendorDecisionMock.mockResolvedValue({ sent: 0 })
  transactionMock.mockImplementation(
    async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        contract: { create: contractCreateMock },
        contractDocument: { createMany: vi.fn() },
        productCategory: { findMany: vi.fn().mockResolvedValue([]) },
        contractProductCategory: { createMany: vi.fn() },
        pendingContract: { updateMany: txPendingUpdateMock },
      }),
  )
})

describe("createPendingContract — one_way auto-activation", () => {
  it("materializes immediately for a connected facility, and skips the review email", async () => {
    pendingCreateMock.mockResolvedValue(
      pendingRow({ facilityId: "fac-1", facilityName: "Lighthouse Surgical Center" }),
    )
    resolveOperatingModeMock.mockResolvedValue({
      mode: "one_way",
      source: "connection",
      hasConnectionForFacility: true,
      connectionStatus: "accepted",
    })
    canAutoActivateMock.mockReturnValue(true)
    pendingFindUniqueOrThrowMock.mockResolvedValue(
      pendingRow({
        facilityId: "fac-1",
        status: "approved",
        approvedContractId: "contract-1",
      }),
    )

    const result = await createPendingContract(payload({ facilityId: "fac-1" }))

    // The mode question is asked with the caller's OWN vendor id, never the
    // client's `vendorId` field.
    expect(resolveOperatingModeMock).toHaveBeenCalledWith({
      vendorId: "ven-1",
      facilityId: "fac-1",
    })
    // A real Contract row, attributed to the named facility.
    expect(contractCreateMock).toHaveBeenCalledOnce()
    expect(contractCreateMock.mock.calls[0][0].data).toMatchObject({
      vendorId: "ven-1",
      facilityId: "fac-1",
      status: "active",
    })
    // Pending row flipped, reviewer-of-record is the vendor user (session-
    // derived — there is no facility reviewer in one-way mode).
    expect(txPendingUpdateMock).toHaveBeenCalledOnce()
    expect(txPendingUpdateMock.mock.calls[0][0]).toMatchObject({
      // Tenant-scoped compare-and-swap, not a bare `where: {id}`: `vendorId`
      // keeps the write in the row's own tenant and `status` re-checks the
      // submitted-only guard inside the transaction, so two concurrent
      // approvals can't both mint a Contract.
      where: { id: "pend-1", vendorId: "ven-1", status: "submitted" },
      data: {
        status: "approved",
        reviewedBy: "vendor-user-1",
        approvedContractId: "contract-1",
      },
    })
    // No reviewer exists, so nobody is paged.
    expect(notifyFacilityMock).not.toHaveBeenCalled()
    // Callers key off status — return the POST-flip row, not the stale
    // pre-materialize snapshot.
    expect(pendingFindUniqueOrThrowMock).toHaveBeenCalledWith({
      where: { id: "pend-1", vendorId: "ven-1" },
    })
    expect((result as { status: string }).status).toBe("approved")
  })

  it("does NOT auto-activate when canAutoActivate is false — the submit-for-review path is unchanged", async () => {
    // The cross-tenant shape: the payload names a facility the vendor has no
    // accepted Connection with, so the gate says no.
    pendingCreateMock.mockResolvedValue(
      pendingRow({ facilityId: "fac-victim", facilityName: "Someone Else" }),
    )
    resolveOperatingModeMock.mockResolvedValue({
      mode: "one_way",
      source: "vendorDefault",
      hasConnectionForFacility: false,
      connectionStatus: null,
    })
    canAutoActivateMock.mockReturnValue(false)

    const result = await createPendingContract(
      payload({ facilityId: "fac-victim" }),
    )

    expect(contractCreateMock).not.toHaveBeenCalled()
    expect(transactionMock).not.toHaveBeenCalled()
    expect(txPendingUpdateMock).not.toHaveBeenCalled()
    expect((result as { status: string }).status).toBe("submitted")
    // The facility still gets its "you have something to review" notification.
    expect(notifyFacilityMock).toHaveBeenCalledWith(
      expect.objectContaining({ facilityId: "fac-victim", pendingId: "pend-1" }),
    )
  })

  it("standalone vendor (no facility): the contract is its OWN, and the facility-scoped recompute is skipped", async () => {
    pendingCreateMock.mockResolvedValue(pendingRow())
    resolveOperatingModeMock.mockResolvedValue({
      mode: "one_way",
      source: "derived",
      hasConnectionForFacility: false,
      connectionStatus: null,
    })
    canAutoActivateMock.mockReturnValue(true)
    pendingFindUniqueOrThrowMock.mockResolvedValue(
      pendingRow({ status: "approved", approvedContractId: "contract-1" }),
    )

    await createPendingContract(payload())

    expect(resolveOperatingModeMock).toHaveBeenCalledWith({
      vendorId: "ven-1",
      facilityId: null,
    })
    expect(contractCreateMock.mock.calls[0][0].data).toMatchObject({
      facilityId: null,
    })
    // No facility → no COG rows to rematch, and no facility dashboard to bust.
    expect(recomputeMock).not.toHaveBeenCalled()
    const paths = revalidatePathMock.mock.calls.map((c) => c[0] as string)
    expect(paths).toContain("/vendor/contracts")
    expect(paths.some((p) => p.startsWith("/dashboard"))).toBe(false)
    expect(notifyFacilityMock).not.toHaveBeenCalled()
  })

  it("never exports the materializer — in a \"use server\" file that is an ungated RPC", () => {
    // `materializePending` does NO auth of its own; both call sites gate first.
    // Exporting it from this file would publish "turn any submission into a
    // live Contract" as a client-callable Server Action.
    expect(Object.keys(pendingContractActions)).not.toContain(
      "materializePending",
    )
  })

  it("read-only members are blocked before anything is written", async () => {
    requireCanMutateMock.mockRejectedValue(new Error("read-only"))

    await expect(createPendingContract(payload())).rejects.toThrow()

    expect(pendingCreateMock).not.toHaveBeenCalled()
    expect(contractCreateMock).not.toHaveBeenCalled()
  })
})
