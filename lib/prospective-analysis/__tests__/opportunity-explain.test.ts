import { describe, expect, it } from "vitest"

import {
  explainOpportunityEngine,
  type OpportunityExplainSources,
} from "@/lib/prospective-analysis/opportunity-explain"
import {
  computeOpportunityEngine,
  DEFAULT_OPPORTUNITY_SCENARIO,
  type OpportunityScenarioInput,
} from "@/lib/prospective-analysis/opportunity-engine"

const SOURCES: OpportunityExplainSources = {
  priceChangePct: "slider",
  currentShare: "your data",
  targetShare: "slider",
  expectedVolumeGrowthPct: "default",
  incumbentStrength: "your data",
  addressableSpend: "your data",
  currentAsp: "your data",
}

// A fixed, non-default scenario so every lever is exercised.
const SCENARIO: OpportunityScenarioInput = {
  currentAsp: 950,
  priceChangePct: -0.05,
  addressableSpend: 8_000_000,
  currentShare: 0.12,
  targetShare: 0.45,
  expectedVolumeGrowthPct: 0.08,
  incumbentStrength: 0.7,
}

function explainFor(key: string) {
  const explanations = explainOpportunityEngine(SCENARIO, SOURCES)
  const ex = explanations.find((e) => e.key === key)
  if (!ex) throw new Error(`missing explanation for ${key}`)
  return ex
}

describe("explainOpportunityEngine — parity with computeOpportunityEngine", () => {
  const engine = computeOpportunityEngine(SCENARIO)

  it("returns the four output explanations", () => {
    const keys = explainOpportunityEngine(SCENARIO, SOURCES).map((e) => e.key)
    expect(keys).toEqual([
      "winProbability",
      "currentRevenue",
      "incrementalRevenue",
      "netUnitImpact",
    ])
  })

  it("winProbability value matches the engine, and equals logistic of the summed lever contributions", () => {
    const ex = explainFor("winProbability")
    expect(ex.value).toBeCloseTo(engine.winProbability, 10)

    // Every win-prob lever carries a numeric contribution; their sum is the
    // logistic z (baseline 0.1 included as its own lever row).
    const z = ex.levers.reduce((s, l) => s + (l.contribution ?? 0), 0)
    expect(1 / (1 + Math.exp(-z))).toBeCloseTo(engine.winProbability, 10)
  })

  it("win-prob lever contributions match the documented multipliers", () => {
    const ex = explainFor("winProbability")
    const byLabel = new Map(ex.levers.map((l) => [l.label, l]))

    // priceLever = −priceChangePct × 8 → −(−0.05) × 8 = +0.4
    expect(byLabel.get("Price change")?.contribution).toBeCloseTo(0.4, 10)
    // shareLever = −max(0, 0.45 − 0.12) × 2.2 = −0.726
    expect(
      byLabel.get("Share ask (target − current)")?.contribution,
    ).toBeCloseTo(-0.726, 10)
    // growthLever = 0.08 × 2 = 0.16
    expect(byLabel.get("Volume growth")?.contribution).toBeCloseTo(0.16, 10)
    // incumbentLever = −(0.7 − 0.5) × 1.6 = −0.32
    expect(byLabel.get("Incumbent strength")?.contribution).toBeCloseTo(
      -0.32,
      10,
    )
    expect(byLabel.get("Model baseline")?.contribution).toBeCloseTo(0.1, 10)
  })

  it("currentRevenue / incrementalRevenue / netUnitImpact match the engine", () => {
    expect(explainFor("currentRevenue").value).toBeCloseTo(
      engine.currentRevenue,
      6,
    )
    expect(explainFor("incrementalRevenue").value).toBeCloseTo(
      engine.incrementalRevenue,
      6,
    )
    expect(explainFor("netUnitImpact").value).toBeCloseTo(
      engine.netUnitImpact,
      6,
    )
  })

  it("also matches the engine on the DEFAULT scenario seed", () => {
    const defEngine = computeOpportunityEngine(DEFAULT_OPPORTUNITY_SCENARIO)
    const defExplain = explainOpportunityEngine(
      DEFAULT_OPPORTUNITY_SCENARIO,
      SOURCES,
    )
    const byKey = new Map(defExplain.map((e) => [e.key, e.value]))
    expect(byKey.get("winProbability")).toBeCloseTo(defEngine.winProbability, 10)
    expect(byKey.get("currentRevenue")).toBeCloseTo(defEngine.currentRevenue, 6)
    expect(byKey.get("incrementalRevenue")).toBeCloseTo(
      defEngine.incrementalRevenue,
      6,
    )
    expect(byKey.get("netUnitImpact")).toBeCloseTo(defEngine.netUnitImpact, 6)
  })

  it("defaults incumbentStrength to 0.5 (zero contribution) when omitted, mirroring the engine", () => {
    const scenario: OpportunityScenarioInput = {
      ...SCENARIO,
      incumbentStrength: undefined,
    }
    const ex = explainOpportunityEngine(scenario, SOURCES).find(
      (e) => e.key === "winProbability",
    )
    const incumbent = ex?.levers.find((l) => l.label === "Incumbent strength")
    expect(incumbent?.contribution).toBeCloseTo(0, 10)
    expect(ex?.value).toBeCloseTo(
      computeOpportunityEngine(scenario).winProbability,
      10,
    )
  })

  it("clamps shares like the engine (targetShare > 1)", () => {
    const scenario: OpportunityScenarioInput = { ...SCENARIO, targetShare: 1.4 }
    const engineClamped = computeOpportunityEngine(scenario)
    const byKey = new Map(
      explainOpportunityEngine(scenario, SOURCES).map((e) => [e.key, e.value]),
    )
    expect(byKey.get("winProbability")).toBeCloseTo(
      engineClamped.winProbability,
      10,
    )
    expect(byKey.get("incrementalRevenue")).toBeCloseTo(
      engineClamped.incrementalRevenue,
      6,
    )
  })
})

describe("explainOpportunityEngine — source tags", () => {
  it("passes the sources map through to the lever rows", () => {
    const ex = explainFor("winProbability")
    const byLabel = new Map(ex.levers.map((l) => [l.label, l.source]))
    expect(byLabel.get("Price change")).toBe("slider")
    expect(byLabel.get("Share ask (target − current)")).toBe("slider")
    expect(byLabel.get("Volume growth")).toBe("default")
    expect(byLabel.get("Incumbent strength")).toBe("your data")
    expect(byLabel.get("Model baseline")).toBe("default")

    const rev = explainFor("currentRevenue")
    expect(rev.levers.map((l) => l.source)).toEqual(["your data", "your data"])
  })

  it("carries a deal-handoff tag when the section says so", () => {
    const ex = explainOpportunityEngine(SCENARIO, {
      ...SOURCES,
      priceChangePct: "deal handoff",
      targetShare: "deal handoff",
    }).find((e) => e.key === "winProbability")
    const byLabel = new Map(ex?.levers.map((l) => [l.label, l.source]))
    expect(byLabel.get("Price change")).toBe("deal handoff")
    expect(byLabel.get("Share ask (target − current)")).toBe("deal handoff")
  })

  it("states the dollar-share note: price change does not move revenue", () => {
    expect(explainFor("incrementalRevenue").note).toMatch(
      /price change deliberately does not move revenue/i,
    )
  })
})
