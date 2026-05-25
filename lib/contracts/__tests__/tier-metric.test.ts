import { describe, expect, it } from "vitest"
import { pickThresholdMetric } from "@/lib/contracts/tier-metric"

describe("pickThresholdMetric", () => {
  const metrics = {
    currentSpend: 1_234_567,
    currentMarketShare: 92.6,
    complianceRate: 78.2,
    currentVolume: 412,
  }

  it("market_share → currentMarketShare", () => {
    expect(pickThresholdMetric("market_share", metrics)).toBe(92.6)
  })

  it("compliance_rebate → complianceRate", () => {
    expect(pickThresholdMetric("compliance_rebate", metrics)).toBe(78.2)
  })

  it.each([
    "volume_rebate",
    "rebate_per_use",
    "capitated_pricing_rebate",
    "po_rebate",
    "payment_rebate",
  ])("%s → currentVolume", (termType) => {
    expect(pickThresholdMetric(termType, metrics)).toBe(412)
  })

  it.each(["spend_rebate", "growth_rebate", "carve_out", "tie_in", "unknown_termtype"])(
    "%s → currentSpend (default)",
    (termType) => {
      expect(pickThresholdMetric(termType, metrics)).toBe(1_234_567)
    },
  )

  it("returns 0 when the relevant metric is null", () => {
    expect(
      pickThresholdMetric("market_share", { ...metrics, currentMarketShare: null }),
    ).toBe(0)
    expect(
      pickThresholdMetric("compliance_rebate", { ...metrics, complianceRate: null }),
    ).toBe(0)
    expect(
      pickThresholdMetric("volume_rebate", { ...metrics, currentVolume: null }),
    ).toBe(0)
  })
})
