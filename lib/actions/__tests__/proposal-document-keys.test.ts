import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * Storage keys attached to a change proposal, on both sides of the fence.
 *
 * WRITE: a client-supplied key is never trusted. Without a provenance check a
 * vendor could write any guessable key into their own proposal and
 * `assertKeyVisibleToUser` would later presign it for them — cross-tenant file
 * read via self-authorization. That class has already been fixed twice in this
 * codebase (pending-contracts, contracts/documents); this is the third home for
 * keys and it must not reintroduce it.
 *
 * READ: proposal attachments authorize for BOTH parties — the vendor who
 * attached the file and the facility being asked to approve it — and for
 * nobody else.
 */

const {
  contractFindUniqueMock,
  proposalCreateMock,
  requireVendorMock,
  requireAuthMock,
  memberFindFirstMock,
  contractDocFindFirstMock,
  pendingFindManyMock,
  proposalFindManyMock,
  presignDownloadMock,
} = vi.hoisted(() => ({
  contractFindUniqueMock: vi.fn(),
  proposalCreateMock: vi.fn(),
  requireVendorMock: vi.fn(),
  requireAuthMock: vi.fn(),
  memberFindFirstMock: vi.fn(),
  contractDocFindFirstMock: vi.fn(),
  pendingFindManyMock: vi.fn(),
  proposalFindManyMock: vi.fn(),
  presignDownloadMock: vi.fn(),
}))

vi.mock("@/lib/db", () => ({
  prisma: {
    contract: { findUnique: contractFindUniqueMock },
    contractChangeProposal: {
      create: proposalCreateMock,
      findMany: proposalFindManyMock,
    },
    contractDocument: { findFirst: contractDocFindFirstMock },
    pendingContract: { findMany: pendingFindManyMock },
    member: { findFirst: memberFindFirstMock },
  },
}))
vi.mock("@/lib/actions/auth", () => ({
  requireVendor: requireVendorMock,
  requireAuth: requireAuthMock,
  requireFacility: vi.fn(),
}))
vi.mock("@/lib/actions/auth-permissions", () => ({
  requireCanMutate: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("@/lib/serialize", () => ({ serialize: <T,>(v: T) => v }))
vi.mock("@/lib/s3", () => ({
  generatePresignedUploadUrl: vi.fn(),
  generatePresignedDownloadUrl: presignDownloadMock,
  deleteObject: vi.fn(),
}))

import { createChangeProposal } from "@/lib/actions/change-proposals"
import { getDownloadUrl } from "@/lib/actions/uploads"

const VENDOR_ID = "v-1"
const USER_ID = "u-1"
const FACILITY_ID = "f-1"
/** The amendment route mints under `amendments/<userId>/`. */
const OWN_KEY = `amendments/${USER_ID}/1234-abcd1234-amendment.pdf`
const FOREIGN_KEY = "amendments/someone-else/1234-abcd1234-secret.pdf"

const baseInput = {
  contractId: "c-1",
  vendorId: VENDOR_ID,
  vendorName: "Stryker",
  proposalType: "contract_edit" as const,
  changes: [],
}

beforeEach(() => {
  vi.clearAllMocks()
  requireVendorMock.mockResolvedValue({
    vendor: { id: VENDOR_ID, name: "Stryker" },
    user: { id: USER_ID },
  })
  contractFindUniqueMock.mockResolvedValue({
    id: "c-1",
    vendorId: VENDOR_ID,
    facilityId: FACILITY_ID,
    facility: { name: "Lighthouse" },
  })
  proposalCreateMock.mockResolvedValue({ id: "prop-1" })
  requireAuthMock.mockResolvedValue({ user: { id: USER_ID } })
  contractDocFindFirstMock.mockResolvedValue(null)
  pendingFindManyMock.mockResolvedValue([])
  proposalFindManyMock.mockResolvedValue([])
  presignDownloadMock.mockResolvedValue("https://signed.example/url")
})

describe("attaching a document to a change proposal", () => {
  it("accepts a key this caller minted", async () => {
    await createChangeProposal({
      ...baseInput,
      proposedTerms: { documents: [{ name: "Amendment.pdf", url: OWN_KEY }] },
    })
    expect(proposalCreateMock).toHaveBeenCalledTimes(1)
  })

  it("REGRESSION: rejects a key minted by someone else", async () => {
    await expect(
      createChangeProposal({
        ...baseInput,
        proposedTerms: {
          documents: [{ name: "Not mine.pdf", url: FOREIGN_KEY }],
        },
      }),
    ).rejects.toThrow(/was not uploaded by this account/i)
    expect(proposalCreateMock).not.toHaveBeenCalled()
  })

  it("rejects a legacy key with no tenant segment", async () => {
    await expect(
      createChangeProposal({
        ...baseInput,
        proposedTerms: {
          documents: [{ name: "old.pdf", url: "amendments/1234-old.pdf" }],
        },
      }),
    ).rejects.toThrow(/was not uploaded by this account/i)
    expect(proposalCreateMock).not.toHaveBeenCalled()
  })

  it("rejects the whole proposal when ANY attached key is foreign", async () => {
    await expect(
      createChangeProposal({
        ...baseInput,
        proposedTerms: {
          documents: [
            { name: "mine.pdf", url: OWN_KEY },
            { name: "theirs.pdf", url: FOREIGN_KEY },
          ],
        },
      }),
    ).rejects.toThrow(/was not uploaded by this account/i)
    expect(proposalCreateMock).not.toHaveBeenCalled()
  })
})

describe("downloading a proposal attachment", () => {
  const proposalRow = {
    proposedTerms: { documents: [{ name: "Amendment.pdf", url: OWN_KEY }] },
  }

  it("authorizes the vendor who attached it", async () => {
    memberFindFirstMock.mockResolvedValue({
      organization: { facility: null, vendor: { id: VENDOR_ID } },
    })
    proposalFindManyMock.mockResolvedValue([proposalRow])
    await expect(getDownloadUrl(OWN_KEY)).resolves.toBe(
      "https://signed.example/url",
    )
    // Scoped to the caller's own vendor, not queried unscoped.
    expect(proposalFindManyMock.mock.calls[0]![0]).toMatchObject({
      where: { vendorId: VENDOR_ID },
    })
  })

  it("authorizes the reviewing facility — it must read the evidence", async () => {
    memberFindFirstMock.mockResolvedValue({
      organization: { facility: { id: FACILITY_ID }, vendor: null },
    })
    proposalFindManyMock.mockResolvedValue([proposalRow])
    await expect(getDownloadUrl(OWN_KEY)).resolves.toBe(
      "https://signed.example/url",
    )
    expect(proposalFindManyMock.mock.calls[0]![0]).toMatchObject({
      where: { facilityId: FACILITY_ID },
    })
  })

  it("REGRESSION: denies a tenant with no proposal carrying the key", async () => {
    memberFindFirstMock.mockResolvedValue({
      organization: { facility: null, vendor: { id: "other-vendor" } },
    })
    proposalFindManyMock.mockResolvedValue([])
    await expect(getDownloadUrl(OWN_KEY)).rejects.toThrow(
      /not found or not accessible/i,
    )
    expect(presignDownloadMock).not.toHaveBeenCalled()
  })

  it("does not authorize on the display name — only the exact key", async () => {
    memberFindFirstMock.mockResolvedValue({
      organization: { facility: null, vendor: { id: VENDOR_ID } },
    })
    // A proposal whose attachment NAME is the key a caller is asking for.
    proposalFindManyMock.mockResolvedValue([
      { proposedTerms: { documents: [{ name: FOREIGN_KEY, url: OWN_KEY }] } },
    ])
    await expect(getDownloadUrl(FOREIGN_KEY)).rejects.toThrow(
      /not found or not accessible/i,
    )
  })

  it("ignores a malformed proposedTerms blob rather than throwing", async () => {
    memberFindFirstMock.mockResolvedValue({
      organization: { facility: null, vendor: { id: VENDOR_ID } },
    })
    proposalFindManyMock.mockResolvedValue([
      { proposedTerms: { documents: "not-an-array" } },
      { proposedTerms: null },
    ])
    await expect(getDownloadUrl(OWN_KEY)).rejects.toThrow(
      /not found or not accessible/i,
    )
  })
})
