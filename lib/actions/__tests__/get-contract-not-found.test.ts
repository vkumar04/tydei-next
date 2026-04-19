/**
 * Regression test for Charles R5.18 — the score page used to 500 when a
 * user hit `/dashboard/contracts/:id/score` for a contract that does not
 * belong to their facility (stale bookmark, copy-pasted URL, etc.).
 *
 * Root cause: `getContract` calls `prisma.contract.findUniqueOrThrow`
 * with a `contractOwnershipWhere` scope. When the contract does not
 * exist OR is not owned by the caller's facility, Prisma throws
 * `PrismaClientKnownRequestError` with `code === "P2025"` and the
 * unhandled throw surfaced as a 500.
 *
 * The fix lives in `app/dashboard/contracts/[id]/score/page.tsx` — the
 * server component now catches P2025 and calls `notFound()` so the user
 * sees the standard 404 instead of a crash. This test locks in the
 * error-shape contract `getContract` exposes so that handler stays
 * valid: `code === "P2025"` is the signal for "not owned / not found."
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/db", () => ({
  prisma: {
    contract: { findUniqueOrThrow: vi.fn() },
    contractPeriod: {
      findFirst: vi.fn(async () => null),
      aggregate: vi.fn(async () => ({ _sum: { totalSpend: 0 } })),
    },
    cOGRecord: {
      aggregate: vi.fn(async () => ({ _sum: { extendedPrice: 0 } })),
    },
  },
}))

import { prisma } from "@/lib/db"
const findUniqueOrThrow = prisma.contract.findUniqueOrThrow as ReturnType<
  typeof vi.fn
>

vi.mock("@/lib/actions/auth", () => ({
  requireFacility: vi.fn(async () => ({
    facility: { id: "fac-test" },
    user: { id: "user-test" },
  })),
}))

vi.mock("@/lib/actions/contracts-auth", () => ({
  contractOwnershipWhere: vi.fn((id: string, fid: string) => ({
    id,
    OR: [
      { facilityId: fid },
      { contractFacilities: { some: { facilityId: fid } } },
    ],
  })),
  contractsOwnedByFacility: vi.fn(() => ({})),
  facilityScopeClause: vi.fn(() => ({})),
}))

vi.mock("@/lib/serialize", () => ({
  serialize: <T,>(x: T) => x,
}))

// Minimal shape of PrismaClientKnownRequestError: we only depend on
// `code === "P2025"` and `message` in the caller, so simulating those
// two fields is sufficient for the regression contract.
class FakePrismaKnownError extends Error {
  code: string
  constructor(message: string, code: string) {
    super(message)
    this.name = "PrismaClientKnownRequestError"
    this.code = code
  }
}

import { getContract } from "@/lib/actions/contracts"

describe("getContract — cross-facility contract id (Charles R5.18)", () => {
  beforeEach(() => {
    findUniqueOrThrow.mockReset()
  })

  it("throws a P2025-coded error when the contract is not owned by the facility", async () => {
    findUniqueOrThrow.mockImplementation(async () => {
      throw new FakePrismaKnownError(
        "An operation failed because it depends on one or more records that were required but not found. No record was found for a query.",
        "P2025",
      )
    })

    await expect(getContract("bogus-contract-id")).rejects.toMatchObject({
      code: "P2025",
    })
  })

  it("throws a P2025-coded error when the contract id does not exist at all", async () => {
    findUniqueOrThrow.mockImplementation(async () => {
      throw new FakePrismaKnownError("No record was found for a query.", "P2025")
    })

    await expect(getContract("does-not-exist")).rejects.toHaveProperty(
      "code",
      "P2025",
    )
  })
})
