import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * Payor-contract archive key (storage audit 2026-08-05): the extract route
 * archives the source PDF, and the key now persists on the row — with the
 * same provenance rule as contract documents (caller-minted only) — and is
 * deleted from storage when the last referencing row goes.
 */

const { createMock, deleteMock, findUniqueOrThrowMock, countMock, deleteObjectMock } =
  vi.hoisted(() => ({
    createMock: vi.fn(),
    deleteMock: vi.fn(),
    findUniqueOrThrowMock: vi.fn(),
    countMock: vi.fn(),
    deleteObjectMock: vi.fn(),
  }))

vi.mock("@/lib/db", () => ({
  prisma: {
    payorContract: {
      create: createMock,
      delete: deleteMock,
      findUniqueOrThrow: findUniqueOrThrowMock,
      count: countMock,
    },
  },
}))
vi.mock("@/lib/actions/auth", () => ({
  requireFacility: vi.fn().mockResolvedValue({
    facility: { id: "fac-1" },
    user: { id: "u-1" },
  }),
}))
vi.mock("@/lib/actions/auth-permissions", () => ({ requireCanMutate: vi.fn() }))
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }))
vi.mock("@/lib/storage", () => ({ deleteFile: deleteObjectMock }))

import {
  createFacilityPayorContract,
  deleteFacilityPayorContract,
} from "@/lib/actions/facility-payor-contracts"

const BASE = {
  payorName: "Anthem",
  payorType: "commercial" as const,
  facilityId: "fac-1",
  effectiveDate: "2026-01-01",
  expirationDate: "2026-12-31",
  status: "active",
  cptRates: [],
  grouperRates: [],
  implantPassthrough: true,
  implantMarkup: 0,
}

beforeEach(() => {
  vi.clearAllMocks()
  createMock.mockResolvedValue({ id: "pc-1" })
  findUniqueOrThrowMock.mockResolvedValue({ s3Key: null })
  countMock.mockResolvedValue(0)
})

describe("createFacilityPayorContract s3Key", () => {
  it("persists a caller-minted archive key + fileName", async () => {
    await createFacilityPayorContract({
      ...BASE,
      fileName: "anthem-asc.pdf",
      s3Key: "payor-contracts/u-1/1785-ab12cd34-anthem-asc.pdf",
    })
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          fileName: "anthem-asc.pdf",
          s3Key: "payor-contracts/u-1/1785-ab12cd34-anthem-asc.pdf",
        }),
      }),
    )
  })

  it("rejects a key another tenant minted", async () => {
    await expect(
      createFacilityPayorContract({
        ...BASE,
        s3Key: "payor-contracts/other-user/1785-ab12cd34-x.pdf",
      }),
    ).rejects.toThrow(/not uploaded by this account/)
    expect(createMock).not.toHaveBeenCalled()
  })

  it("rejects an absolute URL as s3Key", async () => {
    await expect(
      createFacilityPayorContract({
        ...BASE,
        s3Key: "https://evil.example/x.pdf",
      }),
    ).rejects.toThrow()
    expect(createMock).not.toHaveBeenCalled()
  })
})

describe("deleteFacilityPayorContract cleanup", () => {
  it("deletes the archived object when the row was its last reference", async () => {
    findUniqueOrThrowMock.mockResolvedValue({
      s3Key: "payor-contracts/u-1/1785-ab12cd34-anthem.pdf",
    })
    await deleteFacilityPayorContract("pc-1")
    expect(deleteMock).toHaveBeenCalled()
    expect(deleteObjectMock).toHaveBeenCalledWith(
      "payor-contracts/u-1/1785-ab12cd34-anthem.pdf",
    )
  })

  it("keeps the object when another row still references the key", async () => {
    findUniqueOrThrowMock.mockResolvedValue({
      s3Key: "payor-contracts/u-1/1785-ab12cd34-shared.pdf",
    })
    countMock.mockResolvedValue(1)
    await deleteFacilityPayorContract("pc-1")
    expect(deleteObjectMock).not.toHaveBeenCalled()
  })

  it("row delete succeeds even when S3 cleanup fails", async () => {
    findUniqueOrThrowMock.mockResolvedValue({
      s3Key: "payor-contracts/u-1/1785-ab12cd34-anthem.pdf",
    })
    deleteObjectMock.mockRejectedValue(new Error("bucket unavailable"))
    await expect(deleteFacilityPayorContract("pc-1")).resolves.toBeUndefined()
    expect(deleteMock).toHaveBeenCalled()
  })
})
