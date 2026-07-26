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

// Feature 3 (uploader improvement 3): per-field resolution provenance, so
// "best guess" fuzzy hits can be harvested back into the canonical alias
// lists. Stored alongside the auto mapping in the same autoMapping Json
// column (no new column / migration): when provenance is present we persist
// `{ mapping, provenance }`; otherwise the bare mapping — both shapes read
// back fine for offline harvesting.
const provenanceSchema = z.record(
  z.string(),
  z.enum(["exact", "contains", "fuzzy"]).nullable(),
)

const uploadHeaderEventSchema = z.object({
  surface: z.string().min(1).max(100),
  fileName: z.string().max(500).nullish(),
  headers: z.array(z.string()).max(500),
  autoMapping: mappingSchema,
  /** how each field auto-resolved (feature 3); folded into autoMapping JSON */
  provenance: provenanceSchema.nullish(),
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
    // Fold provenance into the autoMapping JSON when present (feature 3).
    const autoMappingJson = parsed.provenance
      ? { mapping: parsed.autoMapping, provenance: parsed.provenance }
      : parsed.autoMapping
    // read-only-guard-skip: best-effort telemetry, must never block or throw on read-only users
    await prisma.uploadHeaderEvent.create({
      data: {
        surface: parsed.surface,
        fileName: parsed.fileName ?? null,
        headers: parsed.headers,
        autoMapping: autoMappingJson,
        // Json? columns: omit (undefined) → SQL NULL; Prisma rejects a
        // raw JS null for nullable Json without Prisma.JsonNull.
        finalMapping: parsed.finalMapping ?? undefined,
        missingRequired: parsed.missingRequired ?? undefined,
        outcome: parsed.outcome,
      },
    })
  } catch (err) {
    // redirect-swallow-skip: telemetry must never break an upload. This
    // deliberately swallows requireAuth's NEXT_REDIRECT for unauthenticated
    // callers — an anonymous header event is simply dropped, and bouncing a
    // visitor to /login because a telemetry write failed would be far worse.
    console.error("[upload-telemetry] logUploadHeaderEvent failed", err)
  }
}
