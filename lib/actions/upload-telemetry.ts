"use server"

/**
 * Unmapped-header telemetry (uploader improvements 2, 2026-06-13).
 *
 * The shared <PricingFileDropzone> fires this fire-and-forget whenever a
 * file's columns did NOT all auto-resolve (outcome "auto"), the user
 * manually remapped before importing ("manual_fix"), or cancelled after
 * a detection miss ("abandoned"). Fully-clean auto imports are never
 * logged. The rows let us grow the canonical alias lists in
 * lib/utils/parse-pricing-file.ts from real-world headers instead of
 * waiting for "my file doesn't parse" bug reports.
 *
 * MUST NEVER throw to the caller — telemetry must not break uploads.
 */

import { z } from "zod"
import { prisma } from "@/lib/db"
import { requireAuth } from "@/lib/actions/auth"

const mappingSchema = z.record(z.string(), z.string().nullable())

const uploadHeaderEventSchema = z.object({
  surface: z.string().min(1).max(100),
  fileName: z.string().max(500).nullish(),
  headers: z.array(z.string()).max(500),
  autoMapping: mappingSchema,
  finalMapping: mappingSchema.nullish(),
  missingRequired: z.array(z.string()).nullish(),
  outcome: z.enum(["auto", "manual_fix", "abandoned"]),
})

export type UploadHeaderEventInput = z.infer<typeof uploadHeaderEventSchema>

export async function logUploadHeaderEvent(
  input: UploadHeaderEventInput,
): Promise<void> {
  try {
    await requireAuth()
    const parsed = uploadHeaderEventSchema.parse(input)
    await prisma.uploadHeaderEvent.create({
      data: {
        surface: parsed.surface,
        fileName: parsed.fileName ?? null,
        headers: parsed.headers,
        autoMapping: parsed.autoMapping,
        // Json? columns: omit (undefined) → SQL NULL; Prisma rejects a
        // raw JS null for nullable Json without Prisma.JsonNull.
        finalMapping: parsed.finalMapping ?? undefined,
        missingRequired: parsed.missingRequired ?? undefined,
        outcome: parsed.outcome,
      },
    })
  } catch (err) {
    // Telemetry must never break an upload — log server-side and move on
    // (also swallows requireAuth's NEXT_REDIRECT for unauthenticated
    // callers; an anonymous header event is just dropped).
    console.error("[upload-telemetry] logUploadHeaderEvent failed", err)
  }
}
