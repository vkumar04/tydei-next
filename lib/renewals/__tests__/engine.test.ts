/**
 * Tests for the pure renewals calculation engine (lib/renewals/engine.ts).
 * Spec: docs/superpowers/specs/2026-04-18-renewals-rewrite.md §§4, 14, 15.
 */

import { describe, it, expect } from "vitest"
import {
  classifyRenewalStatus,
  generateNegotiationPoints,
  generateRenewalTasks,
  type NegotiationPointsInput,
} from "../engine"

const P4 = "Review pricing on top 10 SKUs vs market rates"
const P5 = "Consider multi-year agreement for rate lock"
const P1 = "Strong performance — leverage for better rates"
const P2 = "Market share exceeded — negotiate tier advancement"

describe("classifyRenewalStatus", () => {
  it("classifies day-30 as critical (upper boundary)", () => {
    expect(classifyRenewalStatus(30)).toBe("critical")
  })

  it("classifies day-31 as warning (just past critical)", () => {
    expect(classifyRenewalStatus(31)).toBe("warning")
  })

  it("classifies day-90 as warning (upper boundary)", () => {
    expect(classifyRenewalStatus(90)).toBe("warning")
  })

  it("classifies day-91 as upcoming (just past warning)", () => {
    expect(classifyRenewalStatus(91)).toBe("upcoming")
  })

  it("classifies day-180 as upcoming (upper boundary)", () => {
    expect(classifyRenewalStatus(180)).toBe("upcoming")
  })

  it("classifies day-181 as ok (just past upcoming)", () => {
    expect(classifyRenewalStatus(181)).toBe("ok")
  })

  it("classifies negative days (already expired) as critical", () => {
    expect(classifyRenewalStatus(-1)).toBe("critical")
    expect(classifyRenewalStatus(-365)).toBe("critical")
  })

  it("classifies day-0 as critical", () => {
    expect(classifyRenewalStatus(0)).toBe("critical")
  })

  it("classifies very large values as ok", () => {
    expect(classifyRenewalStatus(10_000)).toBe("ok")
  })
})

describe("generateNegotiationPoints", () => {
  function input(overrides: Partial<NegotiationPointsInput> = {}): NegotiationPointsInput {
    return {
      commitmentMet: 0,
      currentMarketShare: null,
      marketShareCommitment: null,
      currentTier: 1,
      maxTier: 1,
      ...overrides,
    }
  }

  it("always includes point 4 and point 5 (even when nothing conditional matches)", () => {
    const result = generateNegotiationPoints(
      input({ commitmentMet: 60, currentTier: 5, maxTier: 5 }),
    )
    expect(result).toEqual([P4, P5])
    expect(result).toHaveLength(2)
  })

  it("emits all 5 rules in order when every condition matches", () => {
    const result = generateNegotiationPoints(
      input({
        commitmentMet: 100,
        currentMarketShare: 50,
        marketShareCommitment: 40,
        currentTier: 1,
        maxTier: 3,
      }),
    )
    expect(result).toEqual([P1, P2, "Advance from Tier 1 to Tier 3", P4, P5])
    expect(result).toHaveLength(5)
  })

  it("emits rules 3, 4, 5 when commitment partial and share under commitment but tier advancable", () => {
    const result = generateNegotiationPoints(
      input({
        commitmentMet: 80,
        currentMarketShare: 10,
        marketShareCommitment: 50,
        currentTier: 2,
        maxTier: 3,
      }),
    )
    expect(result).toEqual(["Advance from Tier 2 to Tier 3", P4, P5])
    expect(result).toHaveLength(3)
  })

  it("never emits rule 2 when currentMarketShare is null", () => {
    const result = generateNegotiationPoints(
      input({
        commitmentMet: 100,
        currentMarketShare: null,
        marketShareCommitment: 40,
        currentTier: 1,
        maxTier: 1,
      }),
    )
    expect(result).not.toContain(P2)
    expect(result).toEqual([P1, P4, P5])
  })

  it("never emits rule 2 when marketShareCommitment is null", () => {
    const result = generateNegotiationPoints(
      input({
        commitmentMet: 100,
        currentMarketShare: 80,
        marketShareCommitment: null,
        currentTier: 1,
        maxTier: 1,
      }),
    )
    expect(result).not.toContain(P2)
    expect(result).toEqual([P1, P4, P5])
  })

  it("produces no duplicates across inputs", () => {
    const result = generateNegotiationPoints(
      input({
        commitmentMet: 120,
        currentMarketShare: 100,
        marketShareCommitment: 50,
        currentTier: 1,
        maxTier: 4,
      }),
    )
    expect(new Set(result).size).toBe(result.length)
  })

  it("emits rule 1 at the exact 100 commitment threshold", () => {
    const at = generateNegotiationPoints(input({ commitmentMet: 100 }))
    const below = generateNegotiationPoints(input({ commitmentMet: 99.9 }))
    expect(at).toContain(P1)
    expect(below).not.toContain(P1)
  })

  it("emits rule 2 at equality (currentMarketShare === commitment)", () => {
    const result = generateNegotiationPoints(
      input({
        currentMarketShare: 40,
        marketShareCommitment: 40,
      }),
    )
    expect(result).toContain(P2)
  })
})

describe("generateRenewalTasks", () => {
  it("returns 5 tasks with no auto-completion at commitmentMet=50", () => {
    const tasks = generateRenewalTasks(50)
    expect(tasks).toHaveLength(5)
    expect(tasks.map((t) => t.completed)).toEqual([false, false, false, false, false])
  })

  it("auto-completes task-1 at commitmentMet=80 (task-2 still manual)", () => {
    const tasks = generateRenewalTasks(80)
    expect(tasks).toHaveLength(5)
    expect(tasks.find((t) => t.id === "task-1")?.completed).toBe(true)
    expect(tasks.find((t) => t.id === "task-2")?.completed).toBe(false)
    expect(tasks.find((t) => t.id === "task-3")?.completed).toBe(false)
    expect(tasks.find((t) => t.id === "task-4")?.completed).toBe(false)
    expect(tasks.find((t) => t.id === "task-5")?.completed).toBe(false)
  })

  it("auto-completes task-1 and task-2 at commitmentMet=95", () => {
    const tasks = generateRenewalTasks(95)
    expect(tasks).toHaveLength(5)
    expect(tasks.find((t) => t.id === "task-1")?.completed).toBe(true)
    expect(tasks.find((t) => t.id === "task-2")?.completed).toBe(true)
    expect(tasks.find((t) => t.id === "task-3")?.completed).toBe(false)
    expect(tasks.find((t) => t.id === "task-4")?.completed).toBe(false)
    expect(tasks.find((t) => t.id === "task-5")?.completed).toBe(false)
  })

  it("commitmentMet=100 still only auto-completes tasks 1 and 2 (never 3-5)", () => {
    const tasks = generateRenewalTasks(100)
    expect(tasks.map((t) => t.completed)).toEqual([true, true, false, false, false])
  })

  it("exposes the exact task copy and ids", () => {
    const tasks = generateRenewalTasks(0)
    expect(tasks).toEqual([
      { id: "task-1", task: "Review current performance data", completed: false },
      { id: "task-2", task: "Analyze market pricing trends", completed: false },
      { id: "task-3", task: "Prepare negotiation strategy", completed: false },
      { id: "task-4", task: "Draft renewal terms", completed: false },
      { id: "task-5", task: "Schedule renewal meeting", completed: false },
    ])
  })
})
