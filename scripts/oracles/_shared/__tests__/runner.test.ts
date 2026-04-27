// scripts/oracles/_shared/__tests__/runner.test.ts
import { describe, it, expect } from "vitest"
import { defineOracle, runOracle } from "../runner"

describe("oracle runner", () => {
  it("collects pass+fail checks and reports overall pass when every check passes", async () => {
    const oracle = defineOracle("test-oracle", async (ctx) => {
      ctx.check("a is 1", 1 === 1, "a=1")
      ctx.check("b is 2", 2 === 2, "b=2")
    })
    const result = await runOracle(oracle)
    expect(result.name).toBe("test-oracle")
    expect(result.pass).toBe(true)
    expect(result.checks).toHaveLength(2)
    expect(result.checks.every((c) => c.pass)).toBe(true)
  })

  it("reports overall fail when any check fails", async () => {
    const oracle = defineOracle("test-oracle", async (ctx) => {
      ctx.check("ok", true, "")
      ctx.check("nope", false, "expected 1 got 2")
    })
    const result = await runOracle(oracle)
    expect(result.pass).toBe(false)
    expect(result.checks.filter((c) => !c.pass)).toHaveLength(1)
    expect(result.checks[1].detail).toBe("expected 1 got 2")
  })

  it("captures thrown errors as a single failed check named 'oracle threw'", async () => {
    const oracle = defineOracle("test-oracle", async () => {
      throw new Error("boom")
    })
    const result = await runOracle(oracle)
    expect(result.pass).toBe(false)
    expect(result.checks).toHaveLength(1)
    expect(result.checks[0].name).toBe("oracle threw")
    expect(result.checks[0].detail).toContain("boom")
  })

  it("preserves check order in the report", async () => {
    const oracle = defineOracle("ordered", async (ctx) => {
      ctx.check("first", true, "")
      ctx.check("second", true, "")
      ctx.check("third", true, "")
    })
    const result = await runOracle(oracle)
    expect(result.checks.map((c) => c.name)).toEqual(["first", "second", "third"])
  })
})
