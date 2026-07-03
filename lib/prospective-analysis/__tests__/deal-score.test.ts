import { describe, expect, it } from "vitest"

import {
  DEAL_SCORE_WEIGHTS,
  computeDealScore,
  dealScoreComponentsSchema,
  recommendationForDealScore,
  type DealScoreConstructInput,
  type DealScoreInput,
} from "@/lib/prospective-analysis/deal-score"

function construct(
  overrides: Partial<DealScoreConstructInput> = {},
): DealScoreConstructInput {
  return {
    targetUnitPrice: 100,
    annualVolume: 500,
    rebatePercent: 0,
    benchmarkMedian: null,
    ...overrides,
  }
}

function baseInput(overrides: Partial<DealScoreInput> = {}): DealScoreInput {
  return {
    recommendedGrossMargin: 0.55,
    targetGrossMargin: 0.4,
    floorGrossMargin: 0.25,
    internalCostProvided: false,
    constructs: [construct()],
    currentShareFraction: null,
    targetShareFraction: null,
    actualsPresent: false,
    ...overrides,
  }
}

function component(
  breakdown: ReturnType<typeof computeDealScore>,
  key: string,
) {
  const c = breakdown.components.find((x) => x.key === key)
  if (!c) throw new Error(`missing component ${key}`)
  return c
}

describe("computeDealScore", () => {
  it("empty form (55% GM assumption, no benchmark/shares/actuals) lands 40-60 'negotiate' with zero data confidence and the assumed-margin flag", () => {
    // The exact case that used to score ~95 "strong_accept": no internal
    // cost (analyzer assumed 55% GM → margin well above the 40% target),
    // one free-text construct, no rebate, nothing else entered.
    const breakdown = computeDealScore(baseInput())

    expect(breakdown.overall).toBeGreaterThanOrEqual(40)
    expect(breakdown.overall).toBeLessThanOrEqual(60)
    expect(recommendationForDealScore(breakdown.overall)).toBe("negotiate")

    expect(component(breakdown, "dataConfidence").points).toBe(0)
    expect(breakdown.marginAssumed).toBe(true)
    expect(component(breakdown, "marginVsTarget").detail).toMatch(/55% GM/)

    // Neutral half credits where nothing was provided.
    expect(component(breakdown, "priceVsBenchmark").points).toBe(
      DEAL_SCORE_WEIGHTS.priceVsBenchmark / 2,
    )
    expect(component(breakdown, "shareAskRealism").points).toBe(
      DEAL_SCORE_WEIGHTS.shareAskRealism / 2,
    )
  })

  it("a strong real deal (cheaper than benchmark, healthy rebate, modest share ask, cost entered, actuals) scores >= 80", () => {
    const breakdown = computeDealScore(
      baseInput({
        recommendedGrossMargin: 0.45,
        internalCostProvided: true,
        actualsPresent: true,
        currentShareFraction: 0.3,
        targetShareFraction: 0.38, // +8pts — realistic
        constructs: [
          construct({
            targetUnitPrice: 90,
            benchmarkMedian: 100, // 10% cheaper than market
            rebatePercent: 3, // inside the 2-5% band
          }),
        ],
      }),
    )

    expect(breakdown.overall).toBeGreaterThanOrEqual(80)
    expect(recommendationForDealScore(breakdown.overall)).toBe("strong_accept")
    expect(breakdown.marginAssumed).toBe(false)
    expect(component(breakdown, "dataConfidence").points).toBe(
      DEAL_SCORE_WEIGHTS.dataConfidence,
    )
    expect(component(breakdown, "priceVsBenchmark").points).toBe(
      DEAL_SCORE_WEIGHTS.priceVsBenchmark,
    )
  })

  describe("share-ask realism taper", () => {
    const share = (current: number, target: number) =>
      component(
        computeDealScore(
          baseInput({
            currentShareFraction: current,
            targetShareFraction: target,
          }),
        ),
        "shareAskRealism",
      ).points

    it("full credit at a gap <= 10pts", () => {
      expect(share(0.3, 0.4)).toBe(DEAL_SCORE_WEIGHTS.shareAskRealism)
      expect(share(0.4, 0.35)).toBe(DEAL_SCORE_WEIGHTS.shareAskRealism) // no ask
    })

    it("zero at a gap >= 25pts (the over-ask)", () => {
      expect(share(0.1, 0.35)).toBe(0)
      expect(share(0.1, 0.6)).toBe(0)
    })

    it("tapers linearly between 10 and 25pts", () => {
      // 17.5pt gap = midpoint of the taper → half of 10 = 5.
      expect(share(0.2, 0.375)).toBe(5)
    })

    it("neutral half credit when either share is unknown", () => {
      const half = DEAL_SCORE_WEIGHTS.shareAskRealism / 2
      expect(
        component(
          computeDealScore(
            baseInput({ currentShareFraction: 0.3, targetShareFraction: null }),
          ),
          "shareAskRealism",
        ).points,
      ).toBe(half)
      expect(
        component(
          computeDealScore(
            baseInput({ currentShareFraction: null, targetShareFraction: 0.5 }),
          ),
          "shareAskRealism",
        ).points,
      ).toBe(half)
    })
  })

  describe("rebate competitiveness band (2-5% healthy)", () => {
    const rebate = (pct: number) =>
      component(
        computeDealScore(
          baseInput({ constructs: [construct({ rebatePercent: pct })] }),
        ),
        "rebateCompetitiveness",
      ).points

    it("full credit inside the band, including both edges", () => {
      expect(rebate(2)).toBe(DEAL_SCORE_WEIGHTS.rebateCompetitiveness)
      expect(rebate(3.5)).toBe(DEAL_SCORE_WEIGHTS.rebateCompetitiveness)
      expect(rebate(5)).toBe(DEAL_SCORE_WEIGHTS.rebateCompetitiveness)
    })

    it("scales down below 2% (0% rebate earns nothing)", () => {
      expect(rebate(0)).toBe(0)
      expect(rebate(1)).toBe(DEAL_SCORE_WEIGHTS.rebateCompetitiveness / 2)
    })

    it("tapers above 5% — rich rebates erode margin", () => {
      expect(rebate(8)).toBeLessThan(DEAL_SCORE_WEIGHTS.rebateCompetitiveness)
      expect(rebate(8)).toBeGreaterThan(0)
      expect(rebate(20)).toBe(0)
    })
  })

  describe("price vs benchmark", () => {
    it("spend-weights the discount across benchmarked constructs", () => {
      // Big-spend construct at market, small one 10% cheaper → mostly neutral.
      const breakdown = computeDealScore(
        baseInput({
          constructs: [
            construct({
              targetUnitPrice: 100,
              benchmarkMedian: 100,
              annualVolume: 900,
            }),
            construct({
              targetUnitPrice: 90,
              benchmarkMedian: 100,
              annualVolume: 100,
            }),
          ],
        }),
      )
      const c = component(breakdown, "priceVsBenchmark")
      const half = DEAL_SCORE_WEIGHTS.priceVsBenchmark / 2
      expect(c.points).toBeGreaterThan(half)
      expect(c.points).toBeLessThan(half + 3)
    })

    it("scores zero when pricing far above market", () => {
      const breakdown = computeDealScore(
        baseInput({
          constructs: [
            construct({ targetUnitPrice: 120, benchmarkMedian: 100 }),
          ],
        }),
      )
      expect(component(breakdown, "priceVsBenchmark").points).toBe(0)
    })
  })

  describe("data confidence", () => {
    it("counts each real input as a quarter of the weight", () => {
      const breakdown = computeDealScore(
        baseInput({
          internalCostProvided: true,
          currentShareFraction: 0.2,
        }),
      )
      expect(component(breakdown, "dataConfidence").points).toBe(
        DEAL_SCORE_WEIGHTS.dataConfidence / 2,
      )
      expect(component(breakdown, "dataConfidence").detail).toMatch(
        /2 of 4 real inputs/,
      )
    })
  })

  describe("invariants", () => {
    const cases: DealScoreInput[] = [
      baseInput(),
      baseInput({ recommendedGrossMargin: null, constructs: [] }),
      baseInput({
        recommendedGrossMargin: 1.5,
        internalCostProvided: true,
        actualsPresent: true,
        currentShareFraction: 0,
        targetShareFraction: 1,
        constructs: [
          construct({
            targetUnitPrice: 1,
            benchmarkMedian: 1000,
            rebatePercent: 50,
          }),
        ],
      }),
      baseInput({
        targetGrossMargin: 0.2,
        floorGrossMargin: 0.2, // zero span
        recommendedGrossMargin: 0.19,
      }),
    ]

    it("component maxes always sum to exactly 100 (weights-sum invariance)", () => {
      for (const input of cases) {
        const breakdown = computeDealScore(input)
        const maxSum = breakdown.components.reduce((s, c) => s + c.max, 0)
        expect(maxSum).toBe(100)
        expect(breakdown.components).toHaveLength(5)
      }
    })

    it("overall stays in 0-100 and points stay within each component's max", () => {
      for (const input of cases) {
        const breakdown = computeDealScore(input)
        expect(breakdown.overall).toBeGreaterThanOrEqual(0)
        expect(breakdown.overall).toBeLessThanOrEqual(100)
        for (const c of breakdown.components) {
          expect(c.points).toBeGreaterThanOrEqual(0)
          expect(c.points).toBeLessThanOrEqual(c.max)
        }
      }
    })

    it("components round-trip through the persistence schema (scoreComponents write)", () => {
      const breakdown = computeDealScore(baseInput())
      const parsed = dealScoreComponentsSchema.parse(breakdown.components)
      expect(parsed).toEqual(breakdown.components)
    })
  })

  describe("recommendationForDealScore (80/65/40 parity with lib/actions/prospective.ts)", () => {
    it("maps the legacy thresholds", () => {
      expect(recommendationForDealScore(80)).toBe("strong_accept")
      expect(recommendationForDealScore(79)).toBe("accept")
      expect(recommendationForDealScore(65)).toBe("accept")
      expect(recommendationForDealScore(64)).toBe("negotiate")
      expect(recommendationForDealScore(40)).toBe("negotiate")
      expect(recommendationForDealScore(39)).toBe("reject")
    })
  })
})
