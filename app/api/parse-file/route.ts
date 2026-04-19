import { NextResponse } from "next/server"
import { headers as getHeaders } from "next/headers"
import { auth } from "@/lib/auth-server"
import ExcelJS from "exceljs"
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

    const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "File too large (max 10MB)" },
        { status: 400 }
      )
    }

    const arrayBuffer = await file.arrayBuffer()
    const workbook = new ExcelJS.Workbook()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await workbook.xlsx.load(Buffer.from(arrayBuffer) as any)

    const sheet = workbook.worksheets[0]
    if (!sheet) {
      return NextResponse.json(
        { error: "No sheets found in file" },
        { status: 400 }
      )
    }

    // ExcelJS row.values is 1-indexed: index 0 is undefined
    const headerRow = sheet.getRow(1)
    const rawValues = headerRow.values as (ExcelJS.CellValue | undefined)[]
    const headers: string[] = rawValues
      .slice(1)
      .map((v) => (v != null ? String(v).trim() : ""))

    if (headers.length === 0 || headers.every((h) => h === "")) {
      return NextResponse.json(
        { error: "No headers found in first row" },
        { status: 400 }
      )
    }

    const rows: Record<string, string>[] = []
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return // skip header row
      const record: Record<string, string> = {}
      const values = row.values as (ExcelJS.CellValue | undefined)[]
      headers.forEach((header, index) => {
        if (!header) return
        const cellValue = values[index + 1] // 1-indexed
        record[header] = cellValue != null ? String(cellValue) : ""
      })
      rows.push(record)
    })

    if (rows.length === 0) {
      return NextResponse.json(
        { error: "File contains no data rows" },
        { status: 400 }
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
