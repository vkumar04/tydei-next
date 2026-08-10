import { NextResponse } from "next/server"
import { headers as getHeaders } from "next/headers"
import { unstable_rethrow } from "next/navigation"
import { auth } from "@/lib/auth-server"
import { rateLimit } from "@/lib/rate-limit"
import { denyUnlessPortalWriter } from "@/lib/api/import-route-auth"
import { ingestMedicareRateRows } from "@/lib/actions/medicare-rate-sets"
import { parseXlsxBufferToRows } from "@/lib/actions/imports/shared"
import { XlsxLimitError } from "@/lib/xlsx/parse-xlsx-bounded"
import { CsvLimitError, parseCsvTextBounded } from "@/lib/csv/parse-csv-bounded"

/**
 * CMS ASC rate-table upload for the vendor Dividend/DCF tab. A rate table is
 * a real header-per-column sheet (Procedure Group / CPT / Rate), so this uses
 * the row-record path like the payor-volume and COG routes.
 */
// Kept in step with the action's cap and `medicareAscRatesSchema`.
const MAX_ROWS = 2_000
const MAX_COLUMNS = 32

export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await getHeaders() })
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const denied = await denyUnlessPortalWriter(session.user.id, "vendor")
    if (denied) return denied

    const { success, retryAfterMs } = rateLimit(
      `import-medicare-rates:${session.user.id}`,
      10,
      60_000,
    )
    if (!success) {
      return NextResponse.json(
        { error: "Too many requests", retryAfter: Math.ceil(retryAfterMs / 1000) },
        { status: 429 },
      )
    }

    const formData = await request.formData()
    const file = formData.get("file") as File | null
    const name = formData.get("name")

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 })
    }
    if (typeof name !== "string" || !name.trim()) {
      return NextResponse.json(
        { error: "Give the rate set a name, e.g. \"CY2026 National\"" },
        { status: 400 },
      )
    }

    const MAX_FILE_SIZE = 20 * 1024 * 1024
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "File is too large; rate tables should be under 20MB." },
        { status: 400 },
      )
    }

    const lowerName = file.name.toLowerCase()
    let rows: Record<string, string>[] = []

    if (lowerName.endsWith(".xlsx")) {
      const arrayBuffer = await file.arrayBuffer()
      const parsed = await parseXlsxBufferToRows(Buffer.from(arrayBuffer))
      if (parsed.headers.length === 0) {
        return NextResponse.json(
          { error: "No sheets found in file" },
          { status: 400 },
        )
      }
      rows = parsed.rows
    } else if (lowerName.endsWith(".csv")) {
      const text = await file.text()
      const parsed = parseCsvTextBounded(text, {
        maxRows: MAX_ROWS,
        maxColumns: MAX_COLUMNS,
      })
      if (parsed.rows.length === 0) {
        return NextResponse.json(
          { error: "CSV has no data rows" },
          { status: 400 },
        )
      }
      rows = parsed.rows
    } else {
      return NextResponse.json(
        { error: "Only .xlsx and .csv files are supported" },
        { status: 400 },
      )
    }

    if (rows.length === 0) {
      return NextResponse.json(
        { error: "File contains no data rows" },
        { status: 400 },
      )
    }

    const result = await ingestMedicareRateRows(rows, {
      fileName: file.name,
      name: name.trim(),
    })
    return NextResponse.json(result)
  } catch (error) {
    unstable_rethrow(error)
    console.error("[/api/import-medicare-rates]", error)
    if (error instanceof XlsxLimitError || error instanceof CsvLimitError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    const message = error instanceof Error ? error.message : "Failed to import"
    if (message.includes("end of central directory")) {
      return NextResponse.json(
        {
          error:
            "This file doesn't look like a valid .xlsx workbook. If it's a CSV, rename the extension to .csv and re-upload.",
        },
        { status: 400 },
      )
    }
    const KNOWN = [
      "No rates were recognized",
      "out-of-range rate values",
      "no data rows",
      "rows; max is",
    ]
    if (KNOWN.some((k) => message.includes(k))) {
      return NextResponse.json({ error: message }, { status: 400 })
    }
    return NextResponse.json({ error: "Import failed" }, { status: 500 })
  }
}
