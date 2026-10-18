import { beforeEach, describe, expect, it, vi } from "vitest"
import { z } from "zod"

const ai = vi.hoisted(() => ({ generateText: vi.fn() }))
vi.mock("ai", async (importActual) => ({
  ...(await importActual<typeof import("ai")>()),
  generateText: ai.generateText,
}))

import { generateStructured, jsonOutputInstructions, parseJsonOutput } from "@/lib/ai/generate-structured"
import { claudeHaiku, claudeSonnet } from "@/lib/ai/config"

const schema = z.object({
  name: z.string(),
  total: z.number().optional(),
  tags: z.array(z.string()).optional(),
})

const textResult = (text: string) => ({ text, usage: {}, finishReason: "stop", response: { id: "r", modelId: "m", timestamp: new Date(0) } })

describe("parseJsonOutput", () => {
  it("parses bare JSON", () => {
    expect(parseJsonOutput(schema, '{"name":"A","total":5}')).toEqual({ name: "A", total: 5 })
  })

  it("strips markdown fences and surrounding prose", () => {
    expect(parseJsonOutput(schema, 'Sure:\n```json\n{"name":"B"}\n```\nDone.')).toEqual({ name: "B" })
    expect(parseJsonOutput(schema, 'Here you go {"name":"C","tags":["x"]} thanks')).toEqual({ name: "C", tags: ["x"] })
  })

  it("unwraps a single-key envelope and decodes stringified fields", () => {
    expect(parseJsonOutput(schema, '{"json": {"name":"D"}}')).toEqual({ name: "D" })
    expect(parseJsonOutput(schema, '{"name":"E","tags":"[\\"a\\"]"}')).toEqual({ name: "E", tags: ["a"] })
  })

  it("returns null for prose or a wrong shape", () => {
    expect(parseJsonOutput(schema, "I could not find a contract.")).toBeNull()
    expect(parseJsonOutput(schema, '{"total":"abc"}')).toBeNull()
  })
})

describe("jsonOutputInstructions", () => {
  it("embeds the JSON schema and forbids fences and wrappers", () => {
    const text = jsonOutputInstructions(schema)
    expect(text).toContain("no markdown fences")
    expect(text).toContain("no wrapper object")
    expect(text).toContain('"name"')
    expect(text).toContain('"required":["name"]')
  })
})

describe("generateStructured plain mode", () => {
  beforeEach(() => {
    ai.generateText.mockReset()
    vi.spyOn(console, "warn").mockImplementation(() => {})
  })

  it("sends no output schema, appends the JSON instructions, and parses the text", async () => {
    ai.generateText.mockResolvedValue(textResult('```json\n{"name":"Plain"}\n```'))
    const result = await generateStructured({
      schema,
      outputMode: "plain",
      actionName: "test",
      instructions: "Be precise.",
      messages: [{ role: "user", content: "go" }],
      primary: claudeSonnet,
      fallback: claudeHaiku,
    })
    expect(result).toEqual({ output: { name: "Plain" }, text: '```json\n{"name":"Plain"}\n```', modelUsed: "primary" })
    const call = ai.generateText.mock.calls[0]![0]
    expect(call.output).toBeUndefined()
    expect(call.providerOptions).toBeUndefined()
    expect(call.instructions).toMatch(/^Be precise\.\n\nRespond with exactly one JSON object/)
  })

  it("falls back to the second model when the first returns unparseable text", async () => {
    ai.generateText.mockResolvedValueOnce(textResult("not json")).mockResolvedValueOnce(textResult('{"name":"Second"}'))
    const result = await generateStructured({
      schema,
      outputMode: "plain",
      actionName: "test",
      messages: [{ role: "user", content: "go" }],
      primary: claudeSonnet,
      fallback: claudeHaiku,
    })
    expect(result.modelUsed).toBe("fallback")
    expect(result.output).toEqual({ name: "Second" })
    expect(ai.generateText.mock.calls[1]![0].model).toBe(claudeHaiku)
  })

  it("throws NoObjectGeneratedError when both models return prose", async () => {
    ai.generateText.mockResolvedValue(textResult("nope"))
    await expect(
      generateStructured({ schema, outputMode: "plain", actionName: "test", messages: [{ role: "user", content: "go" }] }),
    ).rejects.toMatchObject({ name: "AI_NoObjectGeneratedError" })
    expect(ai.generateText).toHaveBeenCalledTimes(2)
  })
})
