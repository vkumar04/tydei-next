import { beforeEach, describe, expect, it, vi } from "vitest"

const presignMock = vi.hoisted(() => vi.fn(async () => "https://storage.example/presigned"))
const requireCanMutate = vi.hoisted(() => vi.fn())

vi.mock("@/lib/db", () => ({
  prisma: { member: { findFirst: vi.fn(async () => ({ organization: { facility: { id: "fac-1" }, vendor: null } })) } },
}))
vi.mock("@/lib/actions/auth", () => ({ requireAuth: vi.fn(async () => ({ user: { id: "user-1" } })) }))
vi.mock("@/lib/actions/auth-permissions", () => ({ requireCanMutate }))
vi.mock("@/lib/s3", () => ({
  generatePresignedUploadUrl: presignMock,
  generatePresignedDownloadUrl: vi.fn(),
  deleteObject: vi.fn(),
}))

import { getUploadUrl } from "@/lib/actions/uploads"

const request = { fileName: "contract.pdf", contentType: "application/pdf", folder: "contracts" as const, size: 123_456 }

beforeEach(() => {
  presignMock.mockClear()
  requireCanMutate.mockReset().mockResolvedValue({ tier: "super", side: "facility" })
})

describe("getUploadUrl guards", () => {
  it("blocks read-only users before minting an upload URL", async () => {
    requireCanMutate.mockRejectedValue(new Error("Your access is read-only"))
    await expect(getUploadUrl(request)).rejects.toThrow(/read-only/)
    expect(presignMock).not.toHaveBeenCalled()
  })

  it("signs the exact declared size into the presigned PUT", async () => {
    await getUploadUrl(request)
    expect(presignMock).toHaveBeenCalledWith(expect.stringMatching(/^contracts\/fac-1\//), "application/pdf", 123_456)
  })

  it("rejects files over 100 MB", async () => {
    await expect(getUploadUrl({ ...request, size: 100 * 1024 * 1024 + 1 })).rejects.toThrow(/100 MB/)
    expect(presignMock).not.toHaveBeenCalled()
  })

  it("rejects an empty file", async () => {
    await expect(getUploadUrl({ ...request, size: 0 })).rejects.toThrow(/empty/)
  })
})
