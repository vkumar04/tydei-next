/**
 * Anthropic JSON Schema compatibility guard for the Wave 1 / Wave 2 AI schemas.
 *
 * Production failure (Charles W1.U-D, 2026-04-19): the Messages API returned
 *
 *   output_config.format.schema: For 'integer' type, properties maximum,
 *   minimum are not supported
 *
 * Root cause: Zod 4's `.int()` emits `type: "integer"` plus the safe-integer
 * `minimum` / `maximum` bounds, which Anthropic's Messages API rejects. This
 * test converts the exported schemas to JSON Schema (the same way the Vercel
 * AI SDK does) and asserts no numeric leaf carries `minimum` / `maximum`.
 *
 * If you intentionally add a constraint, either lift it to `.describe(...)`
 * text or carry the Anthropic provider fix through here first.
 */
import { describe, it, expect } from "vitest"
import { z } from "zod"
import {
  renewalBriefSchema,
  renewalBriefInputSchema,
} from "@/lib/ai/renewal-brief-schemas"
import {
  rebateInsightsResponseSchema,
  rebateInsightsInputSchema,
} from "@/lib/ai/rebate-optimizer-schemas"

function assertNoNumericBounds(schema: z.ZodType, label: string) {
  const json = z.toJSONSchema(schema)
  const serialized = JSON.stringify(json)
  // These keywords on a numeric type are what Anthropic rejects. We forbid
  // them anywhere in the document — integers and numbers alike.
  expect(serialized, `${label}: contains "minimum"`).not.toMatch(
    /"minimum":/,
  )
  expect(serialized, `${label}: contains "maximum"`).not.toMatch(
    /"maximum":/,
  )
  expect(serialized, `${label}: contains "exclusiveMinimum"`).not.toMatch(
    /"exclusiveMinimum":/,
  )
  expect(serialized, `${label}: contains "exclusiveMaximum"`).not.toMatch(
    /"exclusiveMaximum":/,
  )
}

describe("AI schemas — Anthropic Messages API compatibility", () => {
  it("renewalBriefSchema has no numeric min/max keywords", () => {
    assertNoNumericBounds(renewalBriefSchema, "renewalBriefSchema")
  })

  it("renewalBriefInputSchema has no numeric min/max keywords", () => {
    assertNoNumericBounds(renewalBriefInputSchema, "renewalBriefInputSchema")
  })

  it("rebateInsightsResponseSchema has no numeric min/max keywords", () => {
    assertNoNumericBounds(
      rebateInsightsResponseSchema,
      "rebateInsightsResponseSchema",
    )
  })

  it("rebateInsightsInputSchema has no numeric min/max keywords", () => {
    assertNoNumericBounds(
      rebateInsightsInputSchema,
      "rebateInsightsInputSchema",
    )
  })
})
