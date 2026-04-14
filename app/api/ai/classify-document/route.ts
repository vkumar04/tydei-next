import { generateText, Output } from "ai"
import { headers } from "next/headers"
import { z } from "zod"
import { auth } from "@/lib/auth-server"
import { geminiModel } from "@/lib/ai/config"
import { rateLimit } from "@/lib/rate-limit"

type Classification =
  | "contract"
  | "amendment"
  | "cog_data"
  | "cog_report"
  | "pricing_file"
  | "pricing_schedule"
  | "invoice"
  | "purchase_order"
  | "unknown"

// v0-style rich classification output
const richClassificationSchema = z.object({
  type: z.enum([
    "contract",
    "amendment",
    "cog_data",
    "cog_report",
    "pricing_file",
    "pricing_schedule",
    "invoice",
    "purchase_order",
    "unknown",
  ]),
  confidence: z.number().min(0).max(1),
  vendorName: z.string().nullable(),
  documentDate: z.string().nullable(),
  contractName: z.string().nullable(),
  invoiceNumber: z.string().nullable(),
  poNumber: z.string().nullable(),
  suggestedCategory: z.string().nullable(),
  dataPeriod: z.string().nullable(),
  year: z.number().int().nullable(),
  quarter: z.number().int().min(1).max(4).nullable(),
  month: z.number().int().min(1).max(12).nullable(),
  recordCount: z.number().nullable(),
  totalValue: z.number().nullable(),
  isDuplicate: z.boolean(),
  duplicateOf: z.string().nullable(),
})

type RichClassification = z.infer<typeof richClassificationSchema>

function emptyRich(
  type: Classification,
  confidence: number,
  overrides: Partial<RichClassification> = {}
): RichClassification {
  return {
    type,
    confidence,
    vendorName: null,
    documentDate: null,
    contractName: null,
    invoiceNumber: null,
    poNumber: null,
    suggestedCategory: null,
    dataPeriod: null,
    year: null,
    quarter: null,
    month: null,
    recordCount: null,
    totalValue: null,
    isDuplicate: false,
    duplicateOf: null,
    ...overrides,
  }
}

/** Extract year/quarter/month from a filename. */
function extractDatePeriod(fileName: string): {
  year: number | null
  quarter: number | null
  month: number | null
  dataPeriod: string | null
} {
  const fn = fileName.toLowerCase()
  let year: number | null = null
  let quarter: number | null = null
  let month: number | null = null
  let dataPeriod: string | null = null

  const yearMatch = fn.match(/20(2[0-9]|30)/)
  if (yearMatch) year = parseInt(`20${yearMatch[1]}`)

  const quarterMatch = fn.match(/q([1-4])/i)
  if (quarterMatch) {
    quarter = parseInt(quarterMatch[1])
    dataPeriod = `Q${quarter}${year ? ` ${year}` : ""}`
  }

  const monthNames = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
  ]
  const shortMonths = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
  for (let i = 0; i < monthNames.length; i++) {
    if (fn.includes(monthNames[i]) || fn.includes(shortMonths[i])) {
      month = i + 1
      dataPeriod = `${monthNames[i][0].toUpperCase()}${monthNames[i].slice(1)}${year ? ` ${year}` : ""}`
      break
    }
  }

  if (!dataPeriod && year) dataPeriod = `Year ${year}`
  return { year, quarter, month, dataPeriod }
}

/** Heuristic header-based classification for CSV/Excel files. */
function classifyByHeaders(headersRow: string[]): {
  classification: Classification
  confidence: number
} {
  const lower = headersRow.map((h) => h.toLowerCase().trim())
  const has = (...terms: string[]) => terms.every((t) => lower.some((h) => h.includes(t)))

  if (
    has("vendor") &&
    (has("purchase order") || has("po number") || has("po no")) &&
    (has("unit cost") || has("unit price"))
  ) {
    return { classification: "cog_data", confidence: 0.92 }
  }
  if (has("vendor") && has("date ordered") && has("unit cost")) {
    return { classification: "cog_data", confidence: 0.9 }
  }

  if (has("vendor_item_no") || has("vendor item") || has("reference") || has("catalog")) {
    if (
      has("contract_price") ||
      has("contract price") ||
      has("list_price") ||
      has("list price") ||
      has("price") ||
      has("net cost") ||
      has("unit price")
    ) {
      return { classification: "pricing_file", confidence: 0.92 }
    }
  }
  if ((has("price") || has("cost")) && (has("uom") || has("description") || has("item"))) {
    return { classification: "pricing_file", confidence: 0.78 }
  }

  if (has("invoice") && has("line item")) {
    return { classification: "invoice", confidence: 0.88 }
  }
  if (has("invoice") && (has("amount") || has("total"))) {
    return { classification: "invoice", confidence: 0.78 }
  }

  return { classification: "unknown", confidence: 0.0 }
}

function parseCSVHeaders(text: string): string[] {
  const firstLine = text.split(/\r?\n/)[0] ?? ""
  return firstLine.split(",").map((h) => h.replace(/^["']|["']$/g, "").trim())
}

export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session) {
      return Response.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { success, retryAfterMs } = rateLimit(`ai-classify:${session.user.id}`, 30, 60_000)
    if (!success) {
      return Response.json(
        { error: "Too many requests", retryAfter: Math.ceil(retryAfterMs / 1000) },
        { status: 429 }
      )
    }

    const formData = await request.formData()
    const file = formData.get("file") as File | null
    const fileName = (formData.get("fileName") as string | null) ?? file?.name ?? "unknown"

    if (!file) {
      return Response.json({ error: "No file provided" }, { status: 400 })
    }

    const ext = fileName.split(".").pop()?.toLowerCase()
    const { year, quarter, month, dataPeriod } = extractDatePeriod(fileName)

    // ── CSV / Excel: header-based heuristics ─────────────────────────
    if (ext === "csv" || ext === "xlsx" || ext === "xls") {
      let heuristic: { classification: Classification; confidence: number } = {
        classification: "unknown",
        confidence: 0,
      }

      if (ext === "csv") {
        const text = await file.text()
        const headerRow = parseCSVHeaders(text)
        heuristic = classifyByHeaders(headerRow)
      } else {
        const nameLower = fileName.toLowerCase()
        if (nameLower.includes("cog") || nameLower.includes("usage") || nameLower.includes("purchase")) {
          heuristic = { classification: "cog_data", confidence: 0.75 }
        } else if (
          nameLower.includes("pricing") ||
          nameLower.includes("price list") ||
          nameLower.includes("catalog")
        ) {
          heuristic = { classification: "pricing_file", confidence: 0.75 }
        } else if (nameLower.includes("invoice")) {
          heuristic = { classification: "invoice", confidence: 0.75 }
        }
      }

      const rich = emptyRich(heuristic.classification, heuristic.confidence, {
        year,
        quarter,
        month,
        dataPeriod,
      })

      return Response.json({
        ...rich,
        // Backward-compat top-level keys.
        classification: heuristic.classification,
        confidence: heuristic.confidence,
      })
    }

    // ── PDF: AI-based rich classification ────────────────────────────
    if (ext === "pdf") {
      const arrayBuffer = await file.arrayBuffer()
      const fileData = new Uint8Array(arrayBuffer)

      try {
        const result = await generateText({
          model: geminiModel,
          output: Output.object({ schema: richClassificationSchema }),
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: `You are classifying a healthcare procurement document.

Classify the document "type" as exactly one of:
contract, amendment, cog_data, cog_report, pricing_file, pricing_schedule, invoice, purchase_order, unknown.

Also extract — best effort, null if unknown:
- vendorName: the vendor/manufacturer name on the document
- documentDate: main document date in YYYY-MM-DD
- contractName: title of the contract (if this is a contract/amendment)
- invoiceNumber: invoice number (if invoice)
- poNumber: purchase order number (if PO)
- suggestedCategory: product category (e.g. "Ortho Spine", "Medical Supplies")
- dataPeriod: period this data covers (e.g. "Q1 2024")
- year/quarter/month: numeric period breakdown
- recordCount: number of line items/records if present
- totalValue: dollar total if present
- isDuplicate: leave false
- duplicateOf: leave null
- confidence: your classification confidence between 0 and 1

Return all fields, using null for any you cannot determine.`,
                },
                {
                  type: "file",
                  data: fileData,
                  mediaType: "application/pdf",
                },
              ],
            },
          ],
        })

        let rich: RichClassification | undefined
        try {
          rich = result.output
        } catch {
          // Salvage from raw text.
          try {
            const cleaned = (result.text ?? "")
              .replace(/```json\n?/g, "")
              .replace(/```\n?/g, "")
              .trim()
            const parsed = JSON.parse(cleaned)
            rich = richClassificationSchema.parse(parsed)
          } catch {
            rich = undefined
          }
        }

        if (!rich) {
          const fallback = emptyRich("unknown", 0, { year, quarter, month, dataPeriod })
          return Response.json({
            ...fallback,
            classification: "unknown" as Classification,
            confidence: 0,
          })
        }

        // Fill in filename-derived period fields if AI missed them.
        const merged: RichClassification = {
          ...rich,
          year: rich.year ?? year,
          quarter: rich.quarter ?? quarter,
          month: rich.month ?? month,
          dataPeriod: rich.dataPeriod ?? dataPeriod,
        }

        return Response.json({
          ...merged,
          classification: merged.type,
          confidence: merged.confidence,
        })
      } catch (err) {
        console.error("[classify-document] AI classification failed:", err)
        const fallback = emptyRich("unknown", 0, { year, quarter, month, dataPeriod })
        return Response.json({
          ...fallback,
          classification: "unknown" as Classification,
          confidence: 0,
        })
      }
    }

    // Unsupported file type
    const fallback = emptyRich("unknown", 0, { year, quarter, month, dataPeriod })
    return Response.json({
      ...fallback,
      classification: "unknown" as Classification,
      confidence: 0,
    })
  } catch (error) {
    console.error("Document classification error:", error)
    return Response.json({ error: "Classification failed" }, { status: 500 })
  }
}
