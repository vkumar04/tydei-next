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
    // ExcelJS handles modern .xlsx (zip-based OOXML); legacy .xls is
    // BIFF binary and ExcelJS rejects it with "end of central
    // directory". Vick 2026-05-26 sent a real-world Zimmer Biomet .xls
    // pricing export — route those through SheetJS, which reads both
    // BIFF and OOXML. Keep ExcelJS as the primary path for .xlsx
    // (smaller hot-path, no SheetJS in the streaming response).
    let headers: string[]
    let rows: Record<string, string>[]
    const isLegacyXls =
      lowerName.endsWith(".xls") && !lowerName.endsWith(".xlsx")

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
      const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
        header: 1,
        defval: "",
        raw: false,
      })
      if (matrix.length === 0) {
        return NextResponse.json(
          { error: "No headers found in first row" },
          { status: 400 },
        )
      }
      headers = (matrix[0] ?? []).map((v) =>
        v != null ? String(v).trim() : "",
      )
      rows = []
      for (let r = 1; r < matrix.length; r += 1) {
        const arr = matrix[r] ?? []
        const record: Record<string, string> = {}
        headers.forEach((h, idx) => {
          if (!h) return
          const cell = arr[idx]
          record[h] = cell != null ? String(cell) : ""
        })
        rows.push(record)
      }
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

      // ExcelJS row.values is 1-indexed: index 0 is undefined
      const headerRow = sheet.getRow(1)
      const rawValues = headerRow.values as (ExcelJS.CellValue | undefined)[]
      headers = rawValues
        .slice(1)
        .map((v) => (v != null ? String(v).trim() : ""))

      if (headers.length === 0 || headers.every((h) => h === "")) {
        return NextResponse.json(
          { error: "No headers found in first row" },
          { status: 400 },
        )
      }

      rows = []
      sheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return
        const record: Record<string, string> = {}
        const values = row.values as (ExcelJS.CellValue | undefined)[]
        headers.forEach((header, index) => {
          if (!header) return
          const cellValue = values[index + 1]
          record[header] = cellValue != null ? String(cellValue) : ""
        })
        rows.push(record)
      })
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
