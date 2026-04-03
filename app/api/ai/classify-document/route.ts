import { generateText } from "ai"
import { headers } from "next/headers"
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

/** Heuristic header-based classification for CSV/Excel files. */
function classifyByHeaders(headersRow: string[]): {
  classification: Classification
  confidence: number
} {
  const lower = headersRow.map((h) => h.toLowerCase().trim())
  const has = (...terms: string[]) =>
    terms.every((t) => lower.some((h) => h.includes(t)))

  // COG / usage data
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

  // Pricing file
  if (has("vendor_item_no") || has("vendor item")) {
    if (has("contract_price") || has("contract price") || has("list_price") || has("list price")) {
      return { classification: "pricing_file", confidence: 0.92 }
    }
  }
  if (has("catalog") && has("price")) {
    return { classification: "pricing_file", confidence: 0.8 }
  }

  // Invoice
  if (has("invoice") && has("line item")) {
    return { classification: "invoice", confidence: 0.88 }
  }
  if (has("invoice") && (has("amount") || has("total"))) {
    return { classification: "invoice", confidence: 0.78 }
  }

  return { classification: "unknown", confidence: 0.0 }
}

/** Read the first line (headers) from CSV text. */
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

    const { success, retryAfterMs } = rateLimit(
      `ai-classify:${session.user.id}`,
      30,
      60_000
    )
    if (!success) {
      return Response.json(
        {
          error: "Too many requests",
          retryAfter: Math.ceil(retryAfterMs / 1000),
        },
        { status: 429 }
      )
    }

    const formData = await request.formData()
    const file = formData.get("file") as File | null
    const fileName =
      (formData.get("fileName") as string | null) ?? file?.name ?? "unknown"

    if (!file) {
      return Response.json({ error: "No file provided" }, { status: 400 })
    }

    const ext = fileName.split(".").pop()?.toLowerCase()

    // ── CSV / Excel: header-based heuristic classification ──────────
    if (ext === "csv" || ext === "xlsx" || ext === "xls") {
      let headerRow: string[] = []

      if (ext === "csv") {
        const text = await file.text()
        headerRow = parseCSVHeaders(text)
      } else {
        // For Excel files, read first few bytes to check for header-like content.
        // Since we can't parse xlsx server-side without a heavy dependency, we
        // send the file name + extension as a strong signal and fall back to AI
        // classification only if heuristics fail.
        // Use the filename itself as a heuristic hint
        const nameLower = fileName.toLowerCase()
        if (
          nameLower.includes("cog") ||
          nameLower.includes("usage") ||
          nameLower.includes("purchase")
        ) {
          return Response.json({
            classification: "cog_data" as Classification,
            confidence: 0.75,
          })
        }
        if (
          nameLower.includes("pricing") ||
          nameLower.includes("price list") ||
          nameLower.includes("catalog")
        ) {
          return Response.json({
            classification: "pricing_file" as Classification,
            confidence: 0.75,
          })
        }
        if (nameLower.includes("invoice")) {
          return Response.json({
            classification: "invoice" as Classification,
            confidence: 0.75,
          })
        }
        // Can't parse xlsx headers without a library; mark unknown
        return Response.json({
          classification: "unknown" as Classification,
          confidence: 0.0,
        })
      }

      const result = classifyByHeaders(headerRow)
      return Response.json(result)
    }

    // ── PDF: AI-based classification ────────────────────────────────
    if (ext === "pdf") {
      const arrayBuffer = await file.arrayBuffer()
      const fileData = new Uint8Array(arrayBuffer)

      const result = await generateText({
        model: geminiModel,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Classify this document as exactly one of: contract, amendment, cog_report, pricing_schedule, invoice, purchase_order, unknown.

Return ONLY valid JSON (no markdown fences) with this shape:
{ "classification": "<one of the types above>", "confidence": <number between 0 and 1> }`,
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

      try {
        const cleaned = (result.text ?? "")
          .replace(/```json\n?/g, "")
          .replace(/```\n?/g, "")
          .trim()
        const parsed = JSON.parse(cleaned) as {
          classification: string
          confidence: number
        }
        return Response.json({
          classification: parsed.classification || "unknown",
          confidence:
            typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
        })
      } catch {
        return Response.json({
          classification: "unknown" as Classification,
          confidence: 0.0,
        })
      }
    }

    // Unsupported file type
    return Response.json({
      classification: "unknown" as Classification,
      confidence: 0.0,
    })
  } catch (error) {
    console.error("Document classification error:", error)
    return Response.json({ error: "Classification failed" }, { status: 500 })
  }
}
