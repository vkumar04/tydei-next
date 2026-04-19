import { describe, it, expect } from "vitest"
import { dealScoreSchema } from "@/lib/ai/schemas"

/** Anthropic's Messages API rejects JSON Schema `minimum`/`maximum` on `number`
 * types. Zod .min().max() on numbers compile to those keywords via the AI SDK.
 * Guard the schema by asserting no numeric leaf has min/max constraints. */
describe("dealScoreSchema — Anthropic compatibility", () => {
  it("has no min/max constraints on numeric fields", () => {
    const json = JSON.stringify(dealScoreSchema._def, (_, v) =>
      typeof v === "bigint" ? String(v) : v,
    )
    // Zod v3 serializes number checks as { kind: "min" | "max", value: N } in
    // _def.checks. Zod v4 surfaces them as `minValue` / `maxValue` on the
    // numeric schema. Either representation causes the AI SDK to emit JSON
    // Schema `minimum`/`maximum` keywords, which Anthropic's Messages API
    // rejects with a 400.
    expect(json).not.toMatch(/"kind":"min"/)
    expect(json).not.toMatch(/"kind":"max"/)
    expect(json).not.toMatch(/"minValue":\s*\d/)
    expect(json).not.toMatch(/"maxValue":\s*\d/)
  })
})
