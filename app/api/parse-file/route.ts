import { NextResponse } from "next/server"
import { headers as getHeaders } from "next/headers"
import { auth } from "@/lib/auth-server"
import * as XLSX from "xlsx"
import { rateLimit } from "@/lib/rate-limit"
import { matrixToHeadersAndRows } from "@/lib/utils/tabular/detect-headers"
import {
  parseXlsxMatrixBounded,
  XlsxLimitError,
} from "@/lib/xlsx/parse-xlsx-bounded"

export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await getHeaders() })
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { success, retryAfterMs } = rateLimit(`parse-file:${session.user.id}`, 30, 60_000)
    if (!success) {
      return NextResponse.json(
        { error: "Too many requests", retryAfter: Math.ceil(retryAfterMs / 1000) },
        { status: 429 }
      )
    }

    const formData = await request.formData()
    const file = formData.get("file") as File | null

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 })
    }

    // Bug #27 (2026-05-11, Vick): real-facility COG dumps run
    // 50-200MB on quarterly exports. The old 10MB cap silently
    // refused the user's standard XLS export ("the main XLS file I
    // use every time"); they had to fall back to a small CSV slice.
    // Bumped to 100MB and surface the actual MB number so the user
    // can tell whether to split the file vs save-as-CSV.
    const MAX_FILE_SIZE = 100 * 1024 * 1024 // 100MB
    if (file.size > MAX_FILE_SIZE) {
      const mb = (file.size / (1024 * 1024)).toFixed(1)
      return NextResponse.json(
        {
          error: `File is ${mb}MB; max is 100MB. Split the workbook into multiple sheets/files, or export each tab as a separate .csv.`,
        },
        { status: 400 },
      )
    }

    const arrayBuffer = await file.arrayBuffer()
    const lowerName = file.name.toLowerCase()
    const isLegacyXls =
      lowerName.endsWith(".xls") && !lowerName.endsWith(".xlsx")

    // Vick 2026-05-30 bug: ExcelJS returns object-shaped values for
    // rich-text / hyperlink / formula cells. Stringifying those with
    // `String(v)` produced "[object Object]" in the Description
    // column of every pricing import that came from a styled
    // workbook. Coerce to a plain string up front per known shape.
    function coerceCellToString(v: unknown): string {
      if (v == null) return ""
      if (typeof v === "string") return v
      if (typeof v === "number" || typeof v === "boolean") return String(v)
      if (v instanceof Date) return v.toISOString()
      if (typeof v === "object") {
        const o = v as Record<string, unknown>
        // ExcelJS hyperlink cell
        if (typeof o.text === "string") return o.text
        // ExcelJS rich-text cell: { richText: [{ text, font }, ...] }
        if (Array.isArray(o.richText)) {
          return o.richText
            .map((r) => {
              if (r && typeof r === "object" && typeof (r as Record<string, unknown>).text === "string") {
                return (r as { text: string }).text
              }
              return ""
            })
            .join("")
        }
        // ExcelJS formula cell: { formula, result }
        if (o.formula != null && "result" in o) {
          return coerceCellToString((o as { result: unknown }).result)
        }
        // ExcelJS error cell: { error: "#REF!" } etc.
        if (typeof o.error === "string") return ""
      }
      return ""
    }

    // Step 1: parse into a uniform string[][] matrix regardless of format.
    // ExcelJS handles modern .xlsx (zip-based OOXML); legacy .xls is BIFF
    // binary and ExcelJS rejects it with "end of central directory" —
    // route those through SheetJS (xlsx@0.18.5). Keep ExcelJS as the
    // primary path for .xlsx (smaller hot-path, no SheetJS in the
    // streaming response).
    let matrix: string[][]

    if (isLegacyXls) {
      const workbook = XLSX.read(Buffer.from(arrayBuffer), { type: "buffer" })
      const firstSheetName = workbook.SheetNames[0]
      if (!firstSheetName) {
        return NextResponse.json(
          { error: "No sheets found in file" },
          { status: 400 },
        )
      }
      const sheet = workbook.Sheets[firstSheetName]
      if (!sheet) {
        return NextResponse.json(
          { error: "First sheet is empty" },
          { status: 400 },
        )
      }
      const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
        header: 1,
        defval: "",
        raw: false,
      })
      matrix = raw.map((row) =>
        (row ?? []).map((v) => coerceCellToString(v).trim()),
      )
    } else {
      // Memory-bounded streaming parse (security #9): never materialize the
      // whole sheet — a decompression bomb would OOM the container. Caps
      // abort an absurd row/cell count early.
      matrix = await parseXlsxMatrixBounded(Buffer.from(arrayBuffer), (v) =>
        coerceCellToString(v).trim(),
      )
    }

    // Step 2: header-row detection + dedup + row→object map. This logic
    // is shared VERBATIM with the client-side XLSX/XLS reader via
    // lib/utils/tabular/detect-headers.ts — the matrix above is the only
    // thing that differs between the two surfaces (ExcelJS/SheetJS here,
    // SheetJS in the browser). It throws on the empty-matrix / no-headers
    // / no-data-rows cases with the same user-facing messages the route
    // previously returned inline; map those back to HTTP 400.
    let detected: ReturnType<typeof matrixToHeadersAndRows>
    try {
      detected = matrixToHeadersAndRows(matrix)
    } catch (detectError) {
      const detectMsg =
        detectError instanceof Error
          ? detectError.message
          : "Failed to parse file"
      return NextResponse.json({ error: detectMsg }, { status: 400 })
    }

    return NextResponse.json({
      headers: detected.headers,
      rows: detected.rows,
      headerRowIndex: detected.headerRowIndex,
    })
  } catch (error) {
    console.error("Parse file error:", error)
    // Workbook exceeded the memory-safety caps (decompression-bomb guard).
    if (error instanceof XlsxLimitError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    // ExcelJS throws "Can't find end of central directory" when the file
    // isn't a valid .xlsx zip — most commonly because a CSV was renamed.
    // Classify that case so the user knows how to self-correct.
    const message = error instanceof Error ? error.message : ""
    if (message.includes("end of central directory")) {
      return NextResponse.json(
        {
          error:
            "This file doesn't look like a valid .xlsx workbook. If it's a CSV, rename the extension to .csv and re-upload.",
        },
        { status: 400 },
      )
    }
    return NextResponse.json(
      { error: "Failed to parse file" },
      { status: 500 }
    )
  }
}
