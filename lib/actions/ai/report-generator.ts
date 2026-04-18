"use server"

/**
 * AI agent — report generator server action.
 *
 * Per docs/superpowers/specs/2026-04-18-ai-agent-rewrite.md §4.4.
 *
 * Wraps the pure report classifier + column template + streaming Claude
 * call. Returns a structured GeneratedReport for the UI to render + export.
 */
import { generateText, Output } from "ai"
import { z } from "zod"
import { requireFacility } from "@/lib/actions/auth"
import { logAudit } from "@/lib/audit"
import { serialize } from "@/lib/serialize"
import { claudeModel } from "@/lib/ai/config"
import {
  classifyReportPrompt,
  REPORT_COLUMN_TEMPLATES,
  buildCSVFilename,
  type ReportType,
} from "@/lib/ai/report-classifier"

export interface GeneratedReport {
  title: string
  description: string
  columns: string[]
  data: Array<Record<string, string | number>>
  generatedAt: string
  reportType: ReportType
  /** Filename suggestion for download: `${title}_${YYYY-MM-DD}.csv` */
  filename: string
  /** Free-text notes from the model (limitations, assumptions). */
  notes: string | null
}

/**
 * Generate a structured report from a natural-language prompt.
 *
 * Flow:
 *   1. Classify prompt deterministically → reportType
 *   2. Pin the column template from REPORT_COLUMN_TEMPLATES[type]
 *   3. Ask Claude for structured output (rows matching the columns)
 *   4. Log audit with type + row count
 *   5. Return the report + filename suggestion
 */
export async function generateReportFromPrompt(input: {
  prompt: string
}): Promise<GeneratedReport> {
  const session = await requireFacility()

  const reportType = classifyReportPrompt(input.prompt)
  const columns = REPORT_COLUMN_TEMPLATES[reportType]

  // Zod shape for the expected structured output.
  const shape: Record<string, z.ZodTypeAny> = {}
  for (const col of columns) {
    shape[col] = z.union([z.string(), z.number()])
  }
  const rowSchema = z.object(shape)
  const reportSchema = z.object({
    title: z.string(),
    description: z.string(),
    data: z.array(rowSchema).max(200),
    notes: z.string().nullable().optional(),
  })

  const systemPrompt = `You are a healthcare contract analytics assistant. Given a user prompt describing a report they need, generate a structured report with these exact columns (do not add or drop columns):\n${columns.map((c) => `- ${c}`).join("\n")}\n\nReport type classification: ${reportType}\nReturn 5-20 realistic sample rows. Every column value should be a string or number. Include a short description and optional notes about assumptions.`

  try {
    const result = await generateText({
      model: claudeModel,
      output: Output.object({ schema: reportSchema }),
      system: systemPrompt,
      prompt: input.prompt,
    })

    const output = result.output as z.infer<typeof reportSchema>
    const generatedAt = new Date().toISOString()
    const filename = buildCSVFilename(output.title, new Date())

    await logAudit({
      userId: session.user.id,
      action: "ai.report_generated",
      entityType: "ai_report",
      metadata: {
        reportType,
        promptLength: input.prompt.length,
        rowCount: output.data.length,
      },
    })

    // Narrow the unknown-indexed output to the string|number record
    // shape our public type promises — the Zod schema enforces this
    // at runtime, so the cast is safe.
    const data = output.data as Array<Record<string, string | number>>

    return serialize({
      title: output.title,
      description: output.description,
      columns,
      data,
      generatedAt,
      reportType,
      filename,
      notes: output.notes ?? null,
    })
  } catch (err) {
    // Degrade gracefully — return an empty report with an error note
    // so the UI can show something instead of throwing.
    const generatedAt = new Date().toISOString()
    const title = `${reportType
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase())} Report`
    return serialize({
      title,
      description: `Could not generate report — ${
        err instanceof Error ? err.message : String(err)
      }`,
      columns,
      data: [],
      generatedAt,
      reportType,
      filename: buildCSVFilename(title, new Date()),
      notes: "Claude call failed; try again or narrow the prompt.",
    })
  }
}
