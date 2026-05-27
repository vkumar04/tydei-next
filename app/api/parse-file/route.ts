import { NextResponse } from "next/server"
import { headers as getHeaders } from "next/headers"
import { auth } from "@/lib/auth-server"
import ExcelJS from "exceljs"
import * as XLSX from "xlsx"
import { rateLimit } from "@/lib/rate-limit"

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
        (row ?? []).map((v) => (v != null ? String(v).trim() : "")),
      )
    } else {
      const workbook = new ExcelJS.Workbook()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await workbook.xlsx.load(Buffer.from(arrayBuffer) as any)

      const sheet = workbook.worksheets[0]
      if (!sheet) {
        return NextResponse.json(
          { error: "No sheets found in file" },
          { status: 400 },
        )
      }
      matrix = []
      sheet.eachRow((row) => {
        const values = row.values as (ExcelJS.CellValue | undefined)[]
        // ExcelJS row.values is 1-indexed; index 0 is undefined.
        matrix.push(
          values.slice(1).map((v) => (v != null ? String(v).trim() : "")),
        )
      })
    }

    if (matrix.length === 0) {
      return NextResponse.json(
        { error: "No data found in first sheet" },
        { status: 400 },
      )
    }

    // Step 2: header-row detection. Vendor pricing exports (DePuy,
    // Stryker, J&J, etc.) frequently put a title row / branding row /
    // blank row above the real header row, so a strict "row 1 is the
    // header" rule rejects them with "No headers found in first row".
    // Scan the first 15 rows for the most plausible header — the row
    // with the most non-empty cells that also contains at least one
    // known pricing-token (item, sku, price, description, ref, …).
    // Fall back to the first row with ≥2 non-empty cells, then row 0.
    const HEADER_TOKENS = [
      "item",
      "sku",
      "part",
      "ref",
      "reference",
      "catalog",
      "product",
      "description",
      "desc",
      "price",
      "cost",
      "uom",
      "unit",
      "category",
      "vendor",
      "manufacturer",
      "list",
      "contract",
      "discount",
      "msrp",
    ]
    const looksLikeHeader = (row: string[]): boolean => {
      const joined = row.join(" ").toLowerCase()
      return HEADER_TOKENS.some((t) => joined.includes(t))
    }
    const nonEmptyCount = (row: string[]) => row.filter((c) => c).length

    const SCAN_LIMIT = Math.min(matrix.length, 15)
    let headerRowIdx = -1
    let bestScore = 0
    for (let r = 0; r < SCAN_LIMIT; r += 1) {
      const row = matrix[r] ?? []
      if (!looksLikeHeader(row)) continue
      const score = nonEmptyCount(row)
      if (score > bestScore) {
        bestScore = score
        headerRowIdx = r
      }
    }
    if (headerRowIdx === -1) {
      // No token match — accept the first row with ≥2 non-empty cells.
      for (let r = 0; r < SCAN_LIMIT; r += 1) {
        if (nonEmptyCount(matrix[r] ?? []) >= 2) {
          headerRowIdx = r
          break
        }
      }
    }
    if (headerRowIdx === -1) headerRowIdx = 0

    const headers = matrix[headerRowIdx] ?? []
    if (headers.length === 0 || headers.every((h) => h === "")) {
      return NextResponse.json(
        {
          error:
            "No headers found in the first 15 rows. Make sure your file has a row with column labels like 'Item No', 'Description', 'Price'.",
        },
        { status: 400 },
      )
    }

    const rows: Record<string, string>[] = []
    for (let r = headerRowIdx + 1; r < matrix.length; r += 1) {
      const arr = matrix[r] ?? []
      if (arr.every((c) => !c)) continue // skip blank separator rows
      const record: Record<string, string> = {}
      headers.forEach((h, idx) => {
        if (!h) return
        record[h] = arr[idx] ?? ""
      })
      rows.push(record)
    }

    if (rows.length === 0) {
      return NextResponse.json(
        { error: "File contains no data rows" },
        { status: 400 },
      )
    }

    return NextResponse.json({
      headers: headers.filter((h) => h !== ""),
      rows,
      headerRowIndex: headerRowIdx,
    })
  } catch (error) {
    console.error("Parse file error:", error)
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
