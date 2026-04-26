import { describe, it, expect, vi, beforeEach } from "vitest"

const { findUniqueOrThrowMock, createMock } = vi.hoisted(() => ({
  findUniqueOrThrowMock: vi.fn(),
  createMock: vi.fn(),
}))

vi.mock("@/lib/db", () => ({
  prisma: {
    contract: { findUniqueOrThrow: findUniqueOrThrowMock },
    contractDocument: { create: createMock },
  },
}))
vi.mock("@/lib/actions/auth", () => ({
  requireFacility: vi.fn().mockResolvedValue({
    facility: { id: "fac-1" },
    user: { id: "u-1" },
  }),
}))
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }))
vi.mock("next/cache", () => import("@/tests/setup/next-cache-mock"))

import { createContractDocument } from "@/lib/actions/contracts/documents"

beforeEach(() => {
  vi.clearAllMocks()
  findUniqueOrThrowMock.mockResolvedValue({ id: "c-1" })
  createMock.mockResolvedValue({
    id: "doc-1",
    contractId: "c-1",
    name: "Amendment A.pdf",
    url: "https://example.com/doc-1",
    type: "amendment",
    uploadDate: new Date("2026-04-19"),
  })
})

describe("createContractDocument", () => {
  it("creates a document row owned by the current facility's contract", async () => {
    const result = await createContractDocument({
      contractId: "c-1",
      name: "Amendment A.pdf",
      url: "https://example.com/doc-1",
      type: "amendment",
    })
    expect(findUniqueOrThrowMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "c-1", facilityId: "fac-1" }),
      }),
    )
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          contractId: "c-1",
          name: "Amendment A.pdf",
          url: "https://example.com/doc-1",
          type: "amendment",
        }),
      }),
    )
    expect(result.id).toBe("doc-1")
  })

  it("rejects when contract belongs to a different facility", async () => {
    findUniqueOrThrowMock.mockRejectedValue(new Error("No Contract found"))
    await expect(
      createContractDocument({
        contractId: "c-other",
        name: "x.pdf",
        url: "https://example.com/x",
        type: "amendment",
      }),
    ).rejects.toThrow()
    expect(createMock).not.toHaveBeenCalled()
  })
})
