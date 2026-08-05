/**
 * Shared structured-output wrapper for every AI extractor in the app.
 *
 * Three goals:
 *
 *   1. **Avoid Anthropic's outputFormat constraints.** Anthropic's
 *      native structured-output (`outputFormat`) mode caps schemas
 *      at 24 optional parameters AND occasionally hits "Grammar
 *      compilation is temporarily unavailable" overloads. The
 *      `jsonTool` mode (older, tool-use-based) has neither limit —
 *      we instruct via providerOptions.anthropic.structuredOutputMode.
 *
 *   2. **Model fallback on transient failures.** Even with jsonTool,
 *      Opus occasionally rate-limits / overloads. Sonnet runs on a
 *      separate capacity pool — falling back keeps users unblocked.
 *
 *   3. **Prompt caching for repeat extractions.** Long PDFs are
 *      expensive to re-process on retries / second uploads. We tag
 *      the file content with `cacheControl: ephemeral` so Anthropic
 *      caches the file representation for ~5 minutes; subsequent
 *      attempts on the same file are dramatically cheaper.
 *
 * Usage:
 *
 *   const { output, modelUsed } = await generateStructured({
 *     schema: extractedContractSchema,
 *     messages: [...],
 *     actionName: "extract-contract",
 *   })
 *
 * Override `primary` / `fallback` per call site (e.g. mechanical
 * tasks like map-columns can start at Sonnet to save credits).
 */

import {
  generateText,
  Output,
  type LanguageModel,
  type ModelMessage,
} from "ai"
import type { z } from "zod"
import { claudeModel, claudeSonnet } from "@/lib/ai/config"

export interface GenerateStructuredInput<T> {
  schema: z.ZodSchema<T>
  messages: ModelMessage[]
  /** For log lines so we can tell which call site fell back. */
  actionName: string
  primary?: LanguageModel
  fallback?: LanguageModel
  /**
   * Client-cancellation signal. When the user navigates away or hits
   * Cancel in the UI, the fetch is aborted and `request.signal` fires;
   * threading it here causes the AI SDK to abort the provider HTTP
   * call so we don't burn credits on work the user will never see.
   */
  abortSignal?: AbortSignal
}

export interface GenerateStructuredResult<T> {
  output: T
  /** Raw text fallback for callers that need to parse manually if
   *  Output.object validation fails downstream. */
  text: string
  modelUsed: "primary" | "fallback"
}

function isTransientError(err: unknown): boolean {
  // Never treat a client cancellation as transient — re-throwing lets
  // the route's outer catch return HTTP 499 instead of burning credits
  // on a fallback model call the user will never see.
  if (err instanceof Error && err.name === "AbortError") return false
  const msg = err instanceof Error ? err.message : String(err)
  return (
    /grammar compilation/i.test(msg) ||
    /overloaded/i.test(msg) ||
    /temporarily unavailable/i.test(msg) ||
    /rate.?limit/i.test(msg) ||
    /timeout/i.test(msg) ||
    /503|504|529/.test(msg)
  )
}

/**
 * Anthropic-specific provider options:
 *   - `structuredOutputMode: 'jsonTool'` avoids the 24-optional-param
 *     limit AND the grammar-compiler overload that hit the contract
 *     extractor on 2026-04-26.
 *   - Falls back to default if the provider isn't Anthropic (the SDK
 *     ignores unknown provider options).
 */
const ANTHROPIC_TOOL_MODE_OPTIONS = {
  anthropic: {
    structuredOutputMode: "jsonTool" as const,
  },
}

/**
 * Repair a schema-validation failure caused by the model WRAPPING the
 * payload in a single envelope key — `{"input": {...}}` — a known jsonTool
 * artifact (live prod failure 2026-08-05: a payor extraction whose content
 * was perfect failed top-level validation because everything sat under
 * `input`). Only unwraps when the raw text parses to a single-key object
 * with a known envelope name AND the inner value validates against the
 * caller's schema — anything else stays a failure.
 */
export function tryUnwrapEnvelope<T>(
  schema: z.ZodSchema<T>,
  err: unknown,
): T | null {
  const text = (err as { text?: unknown } | null)?.text
  if (typeof text !== "string" || !text) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null
  }
  const entries = Object.entries(parsed as Record<string, unknown>)
  if (entries.length !== 1) return null
  const [key, value] = entries[0]
  if (!/^(input|data|response|result|output|payload)$/i.test(key)) return null
  const res = schema.safeParse(value)
  return res.success ? res.data : null
}

function isSchemaMismatch(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === "AI_NoObjectGeneratedError" ||
      /did not match schema/i.test(err.message))
  )
}

export async function generateStructured<T>(
  input: GenerateStructuredInput<T>,
): Promise<GenerateStructuredResult<T>> {
  const primary = input.primary ?? claudeModel
  const fallback = input.fallback ?? claudeSonnet

  const callOpts = {
    output: Output.object({ schema: input.schema }),
    messages: input.messages,
    providerOptions: ANTHROPIC_TOOL_MODE_OPTIONS,
    abortSignal: input.abortSignal,
  }

  try {
    const result = await generateText({ model: primary, ...callOpts })
    return {
      output: result.output,
      text: result.text ?? "",
      modelUsed: "primary",
    }
  } catch (primaryErr: unknown) {
    // Envelope repair first — cheaper than any retry, and the content is
    // often perfect underneath.
    const repaired = tryUnwrapEnvelope(input.schema, primaryErr)
    if (repaired !== null) {
      console.warn(
        `[${input.actionName}] repaired single-key envelope from primary output`,
      )
      return {
        output: repaired,
        text: String((primaryErr as { text?: unknown }).text ?? ""),
        modelUsed: "primary",
      }
    }
    // Schema mismatches are model-behavior flakes, not caller bugs — one
    // fallback attempt is warranted alongside the transient failures.
    if (!isTransientError(primaryErr) && !isSchemaMismatch(primaryErr)) {
      throw primaryErr
    }
    const msg =
      primaryErr instanceof Error ? primaryErr.message : String(primaryErr)
    console.warn(
      `[${input.actionName}] primary model failed (${
        isSchemaMismatch(primaryErr) ? "schema mismatch" : "transient"
      }) — falling back:`,
      msg,
    )
    try {
      const result = await generateText({ model: fallback, ...callOpts })
      return {
        output: result.output,
        text: result.text ?? "",
        modelUsed: "fallback",
      }
    } catch (fallbackErr: unknown) {
      const repairedFallback = tryUnwrapEnvelope(input.schema, fallbackErr)
      if (repairedFallback !== null) {
        console.warn(
          `[${input.actionName}] repaired single-key envelope from fallback output`,
        )
        return {
          output: repairedFallback,
          text: String((fallbackErr as { text?: unknown }).text ?? ""),
          modelUsed: "fallback",
        }
      }
      throw fallbackErr
    }
  }
}

/**
 * Helper to tag a content part with Anthropic's ephemeral prompt
 * cache. Apply to PDF file parts so re-uploads (retries, refinements,
 * different prompts on same doc) skip re-processing.
 *
 * Usage:
 *   {
 *     type: "file",
 *     data: pdfBytes,
 *     mediaType: "application/pdf",
 *     ...withCacheControl(),
 *   }
 */
export function withCacheControl() {
  return {
    providerOptions: {
      anthropic: { cacheControl: { type: "ephemeral" as const } },
    },
  }
}
