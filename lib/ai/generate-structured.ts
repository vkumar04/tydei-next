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
}

export interface GenerateStructuredResult<T> {
  output: T
  /** Raw text fallback for callers that need to parse manually if
   *  Output.object validation fails downstream. */
  text: string
  modelUsed: "primary" | "fallback"
}

function isTransientError(err: unknown): boolean {
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

export async function generateStructured<T>(
  input: GenerateStructuredInput<T>,
): Promise<GenerateStructuredResult<T>> {
  const primary = input.primary ?? claudeModel
  const fallback = input.fallback ?? claudeSonnet

  const callOpts = {
    output: Output.object({ schema: input.schema }),
    messages: input.messages,
    providerOptions: ANTHROPIC_TOOL_MODE_OPTIONS,
  }

  try {
    const result = await generateText({ model: primary, ...callOpts })
    return {
      output: result.output,
      text: result.text ?? "",
      modelUsed: "primary",
    }
  } catch (primaryErr: unknown) {
    if (!isTransientError(primaryErr)) throw primaryErr
    const msg =
      primaryErr instanceof Error ? primaryErr.message : String(primaryErr)
    console.warn(
      `[${input.actionName}] primary model failed transiently — falling back:`,
      msg,
    )
    const result = await generateText({ model: fallback, ...callOpts })
    return {
      output: result.output,
      text: result.text ?? "",
      modelUsed: "fallback",
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
