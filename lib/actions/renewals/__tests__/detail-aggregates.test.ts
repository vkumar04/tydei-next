import { describe, it, expect } from "vitest"
import { mapDetail } from "@/components/facility/renewals/renewals-mappers"
import type { ExpiringContract } from "@/lib/actions/renewals"

describe("mapDetail", () => {
  it("populates totalSpend / rebatesEarned / commitmentProgress from the source row", () => {
    const source: ExpiringContract = {
      id: "c1",
      name: "Med Spine",
      vendorName: "Medtronic",
      expirationDate: new Date("2027-03-31"),
      daysUntilExpiration: 1079,
      currentSpend: 3_668_009,
      rebatesEarned: 169_594,
      marketShareCommitment: 80,
      currentMarketShare: 60,
      totalValue: 4_733_126,
      status: "active",
      tier: { current: 2, total: 3 },
    } as unknown as ExpiringContract

    const detail = mapDetail(source)
    expect(detail.totalSpend).toBe(3_668_009)
    expect(detail.rebatesEarned).toBe(169_594)
    expect(detail.commitmentProgressPercent).toBe(75) // 60 / 80 * 100
    expect(detail.tier).toEqual({ current: 2, total: 3 })
  })

  it("renders commitmentProgressPercent as null when commitment is missing", () => {
    const detail = mapDetail({
      id: "c2",
      name: "x",
      vendorName: "y",
      expirationDate: new Date(),
      daysUntilExpiration: 30,
      currentSpend: 0,
      rebatesEarned: 0,
      marketShareCommitment: null,
      currentMarketShare: null,
      totalValue: 0,
      status: "active",
      tier: { current: 1, total: 1 },
    } as unknown as ExpiringContract)
    expect(detail.commitmentProgressPercent).toBeNull()
  })
})
