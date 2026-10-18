import { describe, it, expect, vi, beforeEach } from "vitest"

const { facilityFindManyMock } = vi.hoisted(() => ({ facilityFindManyMock: vi.fn() }))

vi.mock("@/lib/db", () => ({ prisma: { facility: { findMany: facilityFindManyMock } } }))

import {
  assertFacilitiesInHealthSystem,
  healthSystemFacilityIds,
} from "@/lib/contracts/health-system-facilities"

beforeEach(() => {
  vi.clearAllMocks()
  facilityFindManyMock.mockResolvedValue([{ id: "f-home" }, { id: "f-sister" }])
})

describe("contract facility sharing stays inside the caller's health system", () => {
  it("allows the home facility and its health-system siblings", async () => {
    await expect(
      assertFacilitiesInHealthSystem({ id: "f-home", healthSystemId: "hs-1" }, ["f-home", "f-sister"]),
    ).resolves.toBeUndefined()
    expect(facilityFindManyMock).toHaveBeenCalledWith({
      where: { healthSystemId: "hs-1" },
      select: { id: true },
    })
  })

  it("rejects a facility from another health system", async () => {
    await expect(
      assertFacilitiesInHealthSystem({ id: "f-home", healthSystemId: "hs-1" }, ["f-sister", "f-other-tenant"]),
    ).rejects.toThrow(/health system/)
  })

  it("limits a facility with no health system to itself", async () => {
    expect(await healthSystemFacilityIds({ id: "f-solo", healthSystemId: null })).toEqual(new Set(["f-solo"]))
    expect(facilityFindManyMock).not.toHaveBeenCalled()
    await expect(
      assertFacilitiesInHealthSystem({ id: "f-solo", healthSystemId: null }, ["f-home"]),
    ).rejects.toThrow(/health system/)
  })

  it("skips the lookup when no extra facilities are requested", async () => {
    await assertFacilitiesInHealthSystem({ id: "f-home", healthSystemId: "hs-1" }, [])
    expect(facilityFindManyMock).not.toHaveBeenCalled()
  })
})
