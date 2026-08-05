import { describe, it, expect, vi, beforeEach } from "vitest"

const { findUniqueOrThrowMock, createMock, docFindFirstMock } = vi.hoisted(() => ({
  findUniqueOrThrowMock: vi.fn(),
  createMock: vi.fn(),
  docFindFirstMock: vi.fn(),
}))

vi.mock("@/lib/db", () => ({
  prisma: {
    contract: { findUniqueOrThrow: findUniqueOrThrowMock },
    contractDocument: { create: createMock, findFirst: docFindFirstMock },
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
  docFindFirstMock.mockResolvedValue(null)
  createMock.mockResolvedValue({
    id: "doc-1",
    contractId: "c-1",
    name: "Amendment A.pdf",
    url: "contracts/fac-1/1785145274790-ab12cd34-amendment-a.pdf",
    type: "amendment",
    uploadDate: new Date("2026-04-19"),
  })
})

describe("createContractDocument", () => {
  it("creates a document row owned by the current facility's contract", async () => {
    const result = await createContractDocument({
      contractId: "c-1",
      name: "Amendment A.pdf",
      url: "contracts/fac-1/1785145274790-ab12cd34-amendment-a.pdf",
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
          url: "contracts/fac-1/1785145274790-ab12cd34-amendment-a.pdf",
          type: "amendment",
        }),
      }),
    )
    expect(result.id).toBe("doc-1")
  })

  it("rejects an absolute URL in url — storage keys only", async () => {
    // The Documents tab turns `url` into a navigation target; a stored
    // absolute URL would be a planted-phishing vector (see review 2026-08-05).
    await expect(
      createContractDocument({
        contractId: "c-1",
        name: "evil.pdf",
        url: "https://evil.example/login",
        type: "main",
      }),
    ).rejects.toThrow(/storage key/)
    expect(createMock).not.toHaveBeenCalled()
  })

  it("rejects a key another tenant minted — no self-authorization via ContractDocument", async () => {
    await expect(
      createContractDocument({
        contractId: "c-1",
        name: "stolen.pdf",
        url: "contracts/other-tenant/1785145274790-ab12cd34-stolen.pdf",
        type: "main",
      }),
    ).rejects.toThrow(/not uploaded by this account/)
    expect(createMock).not.toHaveBeenCalled()
  })

  it("allows a key already stored on the same contract (carry-over)", async () => {
    docFindFirstMock.mockResolvedValue({ id: "doc-existing" })
    await expect(
      createContractDocument({
        contractId: "c-1",
        name: "legacy.pdf",
        url: "contracts/1775265753375-legacy.pdf",
        type: "main",
      }),
    ).resolves.toBeTruthy()
  })

  it("rejects when contract belongs to a different facility", async () => {
    findUniqueOrThrowMock.mockRejectedValue(new Error("No Contract found"))
    await expect(
      createContractDocument({
        contractId: "c-other",
        name: "x.pdf",
        url: "contracts/fac-1/1785145274790-ab12cd34-x.pdf",
        type: "amendment",
      }),
    ).rejects.toThrow()
    expect(createMock).not.toHaveBeenCalled()
  })
})
