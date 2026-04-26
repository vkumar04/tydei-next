import { generateStructured } from "@/lib/ai/generate-structured"
import { claudeSonnet } from "@/lib/ai/config"
import { headers } from "next/headers"
import { z } from "zod"
import { auth } from "@/lib/auth-server"
import { rateLimit } from "@/lib/rate-limit"

const requestSchema = z.object({
  sourceHeaders: z.array(z.string()).min(1),
  targetFields: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      required: z.boolean(),
    })
  ),
  sampleRows: z.array(z.record(z.string(), z.string())).max(5).optional(),
})

export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session) {
      return Response.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { success, retryAfterMs } = rateLimit(
      `ai-map-cols:${session.user.id}`,
      30,
      60_000
    )
    if (!success) {
      return Response.json(
        { error: "Too many requests", retryAfter: Math.ceil(retryAfterMs / 1000) },
        { status: 429 }
      )
    }

    const body = requestSchema.parse(await request.json())

    // Build a dynamic Zod schema where each key is a target field
    // and the value is the matched source header (or empty string if no match)
    const mappingShape: Record<string, z.ZodTypeAny> = {}
    for (const field of body.targetFields) {
      mappingShape[field.key] = z
        .string()
        .describe(
          `The source column header that best maps to "${field.label}". ` +
            `Return empty string "" if no source column matches.`
        )
    }
    const mappingSchema = z.object(mappingShape)

    const targetList = body.targetFields
      .map(
        (f) =>
          `- ${f.key} ("${f.label}")${f.required ? " [REQUIRED]" : ""}`
      )
      .join("\n")

    let sampleContext = ""
    if (body.sampleRows?.length) {
      const rows = body.sampleRows
        .map((row) =>
          Object.entries(row)
            .map(([k, v]) => `${k}: ${v}`)
            .join(" | ")
        )
        .join("\n")
      sampleContext = `\n\nSample data rows:\n${rows}`
    }

    const result = await generateStructured({
      schema: mappingSchema,
      actionName: "map-columns",
      primary: claudeSonnet,
      messages: [
        {
          role: "user",
          content: `You are a data mapping assistant. Given a set of source CSV/Excel column headers and target database fields, determine which source column best maps to each target field.

Source column headers:
${body.sourceHeaders.map((h) => `- "${h}"`).join("\n")}

Target fields to map:
${targetList}
${sampleContext}

Rules:
- Each target field should map to exactly one source column, or "" if no match exists.
- Consider synonyms, abbreviations, and common naming variations (e.g. "Mfg No" = "Manufacturer Number", "UOM" = "Unit of Measure", "Eff Date" = "Effective Date").
- A source column can map to at most one target field. If two target fields could match the same source column, pick the best fit.
- Use the sample data rows (if provided) to help disambiguate when column names are ambiguous.
- For required fields, try harder to find a match.`,
        },
      ],
    })

    // Filter out empty-string mappings
    const mapping: Record<string, string> = {}
    const output = result.output as Record<string, string> | undefined
    if (output) {
      for (const [key, value] of Object.entries(output)) {
        if (value && body.sourceHeaders.includes(value)) {
          mapping[key] = value
        }
      }
    }

    return Response.json({ mapping })
  } catch (error) {
    console.error("Column mapping error:", error)
    return Response.json({ error: "Mapping failed" }, { status: 500 })
  }
}
