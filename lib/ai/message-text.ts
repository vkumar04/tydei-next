/**
 * Pure helpers for AI chat message rendering.
 *
 * Mirrors the Vercel AI SDK `UIMessage` shape (parts array of typed
 * fragments) but is loosely typed so it also accepts the provider's
 * richer runtime shape without pulling in the SDK as a compile-time
 * dependency from here. That keeps this module usable from server
 * actions, RSC, client components, and tests alike.
 *
 * Spec: `docs/superpowers/specs/2026-04-18-ai-agent-rewrite.md` §2, row
 * "Message render: join `text`-type parts from `message.parts[]`".
 */

export interface ChatMessagePart {
  type: "text" | "tool-call" | "tool-result" | string
  text?: string
  [key: string]: unknown
}

export interface ChatMessage {
  id: string
  role: "user" | "assistant" | "system"
  parts: ChatMessagePart[]
}

/**
 * Extract plain-text content from a chat message by joining all
 * `text`-typed parts in order. Non-text parts (tool calls / results) are
 * skipped; a text part with an undefined `text` field contributes the
 * empty string. Returns the empty string when no text parts exist.
 */
export function getMessageText(message: ChatMessage): string {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join("")
}

/**
 * True when `message.parts` contains any tool invocation — either an
 * outgoing `tool-call` or a `tool-result` echo from the model. Used by
 * the chat UI to decide whether to render inline tool-execution rows
 * above/alongside the assistant's text.
 */
export function hasToolInvocations(message: ChatMessage): boolean {
  return message.parts.some(
    (part) => part.type === "tool-call" || part.type === "tool-result",
  )
}

/**
 * Filter a message array to just the user- and assistant-authored
 * messages that should appear in the chat log. System messages (prompt
 * injection, role scoping) are stripped; they belong in the request, not
 * in the render tree.
 */
export function visibleMessages<T extends { role: string }>(messages: T[]): T[] {
  return messages.filter(
    (message) => message.role === "user" || message.role === "assistant",
  )
}
