import { describe, expect, it, vi, beforeEach } from "vitest"
import { z } from "zod"

/**
 * Structured-output repair ladder (live prod flakes, 2026-08-05):
 *  1. jsonTool mode sometimes wraps the payload in a single envelope key
 *     ({"input": {...}}) — repair by unwrapping when the inner value
 *     validates, instead of failing an extraction whose content is perfect.
 *  2. Schema mismatches get ONE fallback-model attempt (they're model
 *     flakes, not caller bugs); the fallback's output is repaired too.
 */

const { generateTextMock } = vi.hoisted(() => ({ generateTextMock: vi.fn() }))
vi.mock("ai", () => ({
  generateText: generateTextMock,
  Output: { object: (o: unknown) => o },
}))
vi.mock("@/lib/ai/config", () => ({
  claudeModel: { id: "primary-model" },
  claudeSonnet: { id: "fallback-model" },
}))

import {
  generateStructured,
  tryUnwrapEnvelope,
} from "@/lib/ai/generate-structured"

const schema = z.object({ payorName: z.string(), rate: z.number() })
const GOOD = { payorName: "Acme", rate: 100 }

function noObjectError(text: string): Error & { text: string } {
  const err = new Error(
    "No object generated: response did not match schema.",
  ) as Error & { text: string }
  err.name = "AI_NoObjectGeneratedError"
  err.text = text
  return err
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("tryUnwrapEnvelope", () => {
  it("unwraps a single known envelope key whose value validates", () => {
    expect(
      tryUnwrapEnvelope(schema, noObjectError(JSON.stringify({ input: GOOD }))),
    ).toEqual(GOOD)
    expect(
      tryUnwrapEnvelope(schema, noObjectError(JSON.stringify({ data: GOOD }))),
    ).toEqual(GOOD)
  })

  it("refuses unknown keys, multi-key objects, and invalid inner values", () => {
    expect(
      tryUnwrapEnvelope(schema, noObjectError(JSON.stringify({ evil: GOOD }))),
    ).toBeNull()
    expect(
      tryUnwrapEnvelope(
        schema,
        noObjectError(JSON.stringify({ input: GOOD, extra: 1 })),
      ),
    ).toBeNull()
    expect(
      tryUnwrapEnvelope(
        schema,
        noObjectError(JSON.stringify({ input: { payorName: 42 } })),
      ),
    ).toBeNull()
    expect(tryUnwrapEnvelope(schema, new Error("no text"))).toBeNull()
  })
})

describe("generateStructured repair ladder", () => {
  it("repairs an enveloped primary output without calling the fallback", async () => {
    generateTextMock.mockRejectedValueOnce(
      noObjectError(JSON.stringify({ input: GOOD })),
    )
    const res = await generateStructured({
      schema,
      messages: [],
      actionName: "test",
    })
    expect(res.output).toEqual(GOOD)
    expect(res.modelUsed).toBe("primary")
    expect(generateTextMock).toHaveBeenCalledTimes(1)
  })

  it("falls back once on an unrepairable schema mismatch", async () => {
    generateTextMock
      .mockRejectedValueOnce(noObjectError("total garbage"))
      .mockResolvedValueOnce({ output: GOOD, text: "" })
    const res = await generateStructured({
      schema,
      messages: [],
      actionName: "test",
    })
    expect(res.output).toEqual(GOOD)
    expect(res.modelUsed).toBe("fallback")
    expect(generateTextMock).toHaveBeenCalledTimes(2)
  })

  it("repairs an enveloped FALLBACK output too", async () => {
    generateTextMock
      .mockRejectedValueOnce(noObjectError("garbage"))
      .mockRejectedValueOnce(noObjectError(JSON.stringify({ response: GOOD })))
    const res = await generateStructured({
      schema,
      messages: [],
      actionName: "test",
    })
    expect(res.output).toEqual(GOOD)
    expect(res.modelUsed).toBe("fallback")
  })

  it("still throws non-transient, non-schema errors without a fallback call", async () => {
    generateTextMock.mockRejectedValueOnce(new Error("Invalid API key"))
    await expect(
      generateStructured({ schema, messages: [], actionName: "test" }),
    ).rejects.toThrow(/Invalid API key/)
    expect(generateTextMock).toHaveBeenCalledTimes(1)
  })
})
