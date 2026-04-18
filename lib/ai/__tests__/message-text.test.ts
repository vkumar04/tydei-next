import { describe, it, expect } from "vitest"
import {
  getMessageText,
  hasToolInvocations,
  visibleMessages,
  type ChatMessage,
} from "../message-text"

function msg(
  partial: Partial<ChatMessage> & Pick<ChatMessage, "parts">,
): ChatMessage {
  return {
    id: partial.id ?? "m_1",
    role: partial.role ?? "assistant",
    parts: partial.parts,
  }
}

describe("getMessageText()", () => {
  it("joins all text parts in order", () => {
    const m = msg({
      parts: [
        { type: "text", text: "Hello " },
        { type: "text", text: "world" },
      ],
    })
    expect(getMessageText(m)).toBe("Hello world")
  })

  it("returns the empty string when parts is empty", () => {
    expect(getMessageText(msg({ parts: [] }))).toBe("")
  })

  it("skips non-text parts (tool-call, tool-result)", () => {
    const m = msg({
      parts: [
        { type: "text", text: "Before " },
        { type: "tool-call", toolName: "getAlertsSummary" },
        { type: "tool-result", result: { count: 3 } },
        { type: "text", text: "after" },
      ],
    })
    expect(getMessageText(m)).toBe("Before after")
  })

  it("treats a text part with undefined text as empty string", () => {
    const m = msg({
      parts: [
        { type: "text", text: "A" },
        { type: "text" },
        { type: "text", text: "B" },
      ],
    })
    expect(getMessageText(m)).toBe("AB")
  })

  it("returns empty string when no text parts exist", () => {
    const m = msg({
      parts: [
        { type: "tool-call", toolName: "getContractPerformance" },
        { type: "tool-result", result: {} },
      ],
    })
    expect(getMessageText(m)).toBe("")
  })
})

describe("hasToolInvocations()", () => {
  it("returns true when a tool-call part is present", () => {
    expect(
      hasToolInvocations(
        msg({
          parts: [
            { type: "text", text: "thinking..." },
            { type: "tool-call", toolName: "getAlertsSummary" },
          ],
        }),
      ),
    ).toBe(true)
  })

  it("returns true when a tool-result part is present", () => {
    expect(
      hasToolInvocations(
        msg({ parts: [{ type: "tool-result", result: {} }] }),
      ),
    ).toBe(true)
  })

  it("returns false for a text-only message", () => {
    expect(
      hasToolInvocations(
        msg({ parts: [{ type: "text", text: "just prose" }] }),
      ),
    ).toBe(false)
  })

  it("returns false for an empty parts array", () => {
    expect(hasToolInvocations(msg({ parts: [] }))).toBe(false)
  })
})

describe("visibleMessages()", () => {
  it("strips system messages; keeps user + assistant", () => {
    const messages = [
      { id: "s", role: "system" as const, parts: [] },
      { id: "u", role: "user" as const, parts: [] },
      { id: "a", role: "assistant" as const, parts: [] },
    ]
    const result = visibleMessages(messages)
    expect(result.map((m) => m.id)).toEqual(["u", "a"])
  })

  it("preserves original order of user and assistant messages", () => {
    const messages = [
      { id: "a1", role: "assistant" as const, parts: [] },
      { id: "s1", role: "system" as const, parts: [] },
      { id: "u1", role: "user" as const, parts: [] },
      { id: "a2", role: "assistant" as const, parts: [] },
    ]
    expect(visibleMessages(messages).map((m) => m.id)).toEqual([
      "a1",
      "u1",
      "a2",
    ])
  })

  it("returns an empty array when input is empty", () => {
    expect(visibleMessages([])).toEqual([])
  })
})
