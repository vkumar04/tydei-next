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
 * Anthropic's tool-use / structured-output JSON Schema support is documented
 * at https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/implement-tool-use
 * — at time of writing, the Messages API accepts the core JSON Schema shape
 * (type, properties, required, items, enum, description, oneOf/anyOf) but
 * rejects several validation-only keywords. Confirmed-rejected list below is
 * maintained from real production 400 errors:
 *
 *   - `minimum` / `maximum` / `exclusiveMinimum` / `exclusiveMaximum`
 *     (from Zod `.min()` / `.max()` / `.int()` bounds)
 *   - `pattern` (from Zod `.regex()`)
 *   - `format` on integer types (from Zod `.int().safe()`)
 *   - `multipleOf` (from Zod `.multipleOf()`)
 *
 * If you intentionally add a constraint, either lift it to `.describe(...)`
 * text or carry the Anthropic provider fix through here first.
 *
 * This file also enforces two drift guards peer-reviewed after W1.U-D:
 *
 *   - Every top-level AI schema must carry a `.describe(...)` so prompt
 *     authors know what each schema is for (otherwise the JSON Schema
 *     serializes with an empty description and Claude has to guess).
 *   - No schema property may serialize to an empty `{}` (the signature of
 *     `z.any()` — equivalent to telling Anthropic "literally anything goes",
 *     which eliminates the whole point of structured output).
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

/**
 * Keywords we know cause Anthropic Messages API 400s when present anywhere
 * in the JSON Schema document. Each entry is a pair of `[humanLabel, regex]`
 * so the failure message names the keyword.
 */
const FORBIDDEN_KEYWORDS: ReadonlyArray<readonly [string, RegExp]> = [
  ["minimum", /"minimum":/],
  ["maximum", /"maximum":/],
  ["exclusiveMinimum", /"exclusiveMinimum":/],
  ["exclusiveMaximum", /"exclusiveMaximum":/],
  ["pattern", /"pattern":/],
  ["multipleOf", /"multipleOf":/],
]

/**
 * JSON Schema type guard — walks a serialized JSON Schema looking for
 * `{"type":"integer","format":...}` shapes. Anthropic rejects `format` on
 * integer leaves (it's allowed on strings). We only guard the integer flavor
 * here because `.uuid()` / `.datetime()` on strings are still legal.
 */
function walkNode(node: unknown, visit: (node: Record<string, unknown>) => void) {
  if (!node || typeof node !== "object") return
  if (Array.isArray(node)) {
    for (const item of node) walkNode(item, visit)
    return
  }
  const obj = node as Record<string, unknown>
  visit(obj)
  for (const value of Object.values(obj)) walkNode(value, visit)
}

function findIntegerWithFormat(json: unknown): string[] {
  const hits: string[] = []
  walkNode(json, (obj) => {
    if (obj.type === "integer" && typeof obj.format === "string") {
      hits.push(String(obj.format))
    }
  })
  return hits
}

/**
 * Look for empty-object property schemas — the signature of `z.any()`. In
 * JSON Schema, `z.any()` serializes to `{}` (or exactly the generic
 * `{ "additionalProperties": ... }` without a `type`). We flag any property
 * value that serializes to `{}` exactly.
 */
function findEmptyPropertySchemas(json: unknown): string[] {
  const hits: string[] = []
  walkNode(json, (obj) => {
    const props = obj.properties
    if (!props || typeof props !== "object") return
    for (const [key, value] of Object.entries(props as Record<string, unknown>)) {
      if (
        value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        Object.keys(value as Record<string, unknown>).length === 0
      ) {
        hits.push(key)
      }
    }
  })
  return hits
}

function assertAnthropicCompatible(schema: z.ZodType, label: string) {
  const json = z.toJSONSchema(schema)
  const serialized = JSON.stringify(json)
  for (const [name, re] of FORBIDDEN_KEYWORDS) {
    expect(
      serialized,
      `${label}: JSON schema contains forbidden keyword "${name}" which Anthropic's Messages API rejects`,
    ).not.toMatch(re)
  }
  const integerFormats = findIntegerWithFormat(json)
  expect(
    integerFormats,
    `${label}: JSON schema has integer type(s) with format=${JSON.stringify(
      integerFormats,
    )}; Anthropic rejects "format" on integer leaves`,
  ).toEqual([])

  const emptyProps = findEmptyPropertySchemas(json)
  expect(
    emptyProps,
    `${label}: JSON schema has empty-object property schema(s) ${JSON.stringify(
      emptyProps,
    )} — likely z.any(); switch to z.unknown() or an explicit shape`,
  ).toEqual([])
}

/**
 * Every top-level AI schema should describe itself so prompt authors see
 * the intent at-a-glance in the JSON Schema output, and Claude gets one
 * extra piece of grounding context.
 */
function assertHasTopLevelDescription(schema: z.ZodType, label: string) {
  const json = z.toJSONSchema(schema) as { description?: unknown }
  expect(
    typeof json.description === "string" && json.description.trim().length > 0,
    `${label}: top-level schema is missing a .describe(...) — add one so the JSON Schema document has a description field`,
  ).toBe(true)
}

const TOP_LEVEL_SCHEMAS: ReadonlyArray<readonly [string, z.ZodType]> = [
  ["renewalBriefSchema", renewalBriefSchema],
  ["renewalBriefInputSchema", renewalBriefInputSchema],
  ["rebateInsightsResponseSchema", rebateInsightsResponseSchema],
  ["rebateInsightsInputSchema", rebateInsightsInputSchema],
]

describe("AI schemas — Anthropic Messages API compatibility", () => {
  for (const [label, schema] of TOP_LEVEL_SCHEMAS) {
    it(`${label}: no forbidden JSON Schema keywords`, () => {
      assertAnthropicCompatible(schema, label)
    })
  }
})

describe("AI schemas — drift guards", () => {
  for (const [label, schema] of TOP_LEVEL_SCHEMAS) {
    it(`${label}: has a top-level description`, () => {
      assertHasTopLevelDescription(schema, label)
    })
  }
})
