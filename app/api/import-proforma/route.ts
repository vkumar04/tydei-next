import { NextResponse } from "next/server"
import { headers as getHeaders } from "next/headers"
import { unstable_rethrow } from "next/navigation"
import { auth } from "@/lib/auth-server"
import { rateLimit } from "@/lib/rate-limit"
import { denyUnlessPortalWriter } from "@/lib/api/import-route-auth"
import { ingestProformaMatrix } from "@/lib/actions/proforma-statements"
import { excelCellToString } from "@/lib/actions/imports/shared"
import {
  parseXlsxMatrixBounded,
  XlsxLimitError,
} from "@/lib/xlsx/parse-xlsx-bounded"
import {
  CsvLimitError,
  parseCsvTextToMatrixBounded,
} from "@/lib/csv/parse-csv-bounded"

/**
 * Steady State Proforma upload for the vendor Dividend/DCF tab.
 *
 * Unlike the other import routes this hands the action a raw CELL MATRIX
 * rather than header-keyed records: a P&L is a label/value sheet with no
 * reliable header row, so row 0 is data like any other. The xlsx path uses
 * `parseXlsxMatrixBounded` directly for the same reason.
 *
 * A statement is small (tens of rows), so the caps here are tight.
 */
const MAX_ROWS = 5_000
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
      `import-proforma:${session.user.id}`,
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
    const facilityId = formData.get("facilityId")
    const adhocName = formData.get("adhocName")

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 })
    }

    const MAX_FILE_SIZE = 10 * 1024 * 1024
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "File is too large; a P&L statement should be under 10MB." },
        { status: 400 },
      )
    }

    const lowerName = file.name.toLowerCase()
    let matrix: string[][] = []

    if (lowerName.endsWith(".xlsx")) {
      const arrayBuffer = await file.arrayBuffer()
      matrix = await parseXlsxMatrixBounded(
        Buffer.from(arrayBuffer),
        excelCellToString,
        { maxRows: MAX_ROWS },
      )
    } else if (lowerName.endsWith(".csv")) {
      const text = await file.text()
      // POSITIONAL, not header-keyed: a P&L has no header row, and rebuilding
      // a matrix from header-name keys silently swaps columns whenever two
      // headers share a name — which an Excel-exported title row guarantees
      // (`Steady State Proforma,,` → two blank keys collapse, and the
      // per-case column overwrites the amount column).
      matrix = parseCsvTextToMatrixBounded(text, {
        maxRows: MAX_ROWS,
        maxColumns: MAX_COLUMNS,
      })
    } else {
      return NextResponse.json(
        { error: "Only .xlsx and .csv files are supported" },
        { status: 400 },
      )
    }

    if (matrix.length === 0) {
      return NextResponse.json(
        { error: "File contains no rows" },
        { status: 400 },
      )
    }

    const result = await ingestProformaMatrix(matrix, {
      fileName: file.name,
      facilityId:
        typeof facilityId === "string" && facilityId ? facilityId : undefined,
      adhocName:
        typeof adhocName === "string" && adhocName.trim()
          ? adhocName.trim()
          : undefined,
    })
    return NextResponse.json(result)
  } catch (error) {
    unstable_rethrow(error)
    console.error("[/api/import-proforma]", error)
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
      "Facility not found",
      "No P&L lines were recognized",
      "out-of-range amounts",
      "no rows",
      "rows; a P&L statement",
      "Provide exactly one",
    ]
    if (KNOWN.some((k) => message.includes(k))) {
      return NextResponse.json({ error: message }, { status: 400 })
    }
    return NextResponse.json({ error: "Import failed" }, { status: 500 })
  }
}
