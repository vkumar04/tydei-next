import { describe, expect, it, vi, beforeEach } from "vitest"

/**
 * getUploadUrl mints tenant-provenance keys (security review 2026-08-05):
 *   <folder>/<facilityId|vendorId|userId>/<timestamp>-<rand8>-<safeName>
 * The tenant segment backs the ownership checks on client-submitted keys;
 * the random segment makes keys unguessable (the old form was enumerable
 * from a timestamp + filename).
 */

const { memberFindFirstMock, presignMock } = vi.hoisted(() => ({
  memberFindFirstMock: vi.fn(),
  presignMock: vi.fn().mockResolvedValue("https://storage.example/presigned"),
}))

vi.mock("@/lib/db", () => ({
  prisma: {
    member: { findFirst: memberFindFirstMock },
    contractDocument: { findFirst: vi.fn() },
    pendingContract: { findMany: vi.fn() },
  },
}))
vi.mock("@/lib/actions/auth", () => ({
  requireAuth: vi.fn().mockResolvedValue({ user: { id: "user-7" } }),
}))
vi.mock("@/lib/actions/auth-permissions", () => ({
  requireCanMutate: vi.fn(),
}))
vi.mock("@/lib/s3", () => ({
  generatePresignedUploadUrl: presignMock,
  generatePresignedDownloadUrl: vi.fn(),
  deleteObject: vi.fn(),
}))

import { getUploadUrl } from "@/lib/actions/uploads"

const KEY_SHAPE = /^contracts\/([^/]+)\/\d+-[0-9a-f]{8}-([A-Za-z0-9._-]+)$/

beforeEach(() => {
  vi.clearAllMocks()
})

describe("getUploadUrl key provenance", () => {
  it("mints <folder>/<facilityId>/<ts>-<rand>-<name> for facility members", async () => {
    memberFindFirstMock.mockResolvedValue({
      organization: { facility: { id: "fac-1" }, vendor: null },
    })
    const { key } = await getUploadUrl({
      fileName: "Q1 Report (final).pdf",
      contentType: "application/pdf",
      folder: "contracts",
    })
    const match = KEY_SHAPE.exec(key)
    expect(match, key).not.toBeNull()
    expect(match![1]).toBe("fac-1")
    // Unsafe filename characters are sanitized.
    expect(match![2]).toBe("Q1_Report__final_.pdf")
  })

  it("uses the vendor id for vendor members, userId as last resort", async () => {
    memberFindFirstMock.mockResolvedValue({
      organization: { facility: null, vendor: { id: "ven-2" } },
    })
    const vendorKey = (
      await getUploadUrl({
        fileName: "a.pdf",
        contentType: "application/pdf",
        folder: "contracts",
      })
    ).key
    expect(vendorKey.startsWith("contracts/ven-2/")).toBe(true)

    memberFindFirstMock.mockResolvedValue(null)
    const userKey = (
      await getUploadUrl({
        fileName: "a.pdf",
        contentType: "application/pdf",
        folder: "contracts",
      })
    ).key
    expect(userKey.startsWith("contracts/user-7/")).toBe(true)
  })

  it("two uploads of the same file get different keys (entropy)", async () => {
    memberFindFirstMock.mockResolvedValue({
      organization: { facility: { id: "fac-1" }, vendor: null },
    })
    const input = {
      fileName: "same.pdf",
      contentType: "application/pdf",
      folder: "contracts",
    } as const
    const a = (await getUploadUrl(input)).key
    const b = (await getUploadUrl(input)).key
    expect(a).not.toBe(b)
  })
})
