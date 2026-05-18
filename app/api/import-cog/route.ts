import { NextResponse } from "next/server"
import { headers as getHeaders } from "next/headers"
import { auth } from "@/lib/auth-server"
import ExcelJS from "exceljs"
import { rateLimit } from "@/lib/rate-limit"
import { ingestCOGRecordsRows } from "@/lib/actions/imports/cog-csv-import"

/**
 * Bug 2026-05-18 (Vick "Primary full COG.xlsx" via MassUpload):
 * MassUpload's cogDocs loop did `await file.text()` on an .xlsx file
 * (binary garbage as a string), then passed it to ingestCOGRecordsCSV
 * as a Server Action argument. Two problems:
 *   1. CSV parser can't parse xlsx binary; rows came out empty/garbage.
 *   2. Large Server Action payloads trip RSC's array-nesting cap.
 *
 * Following the same pattern as /api/import-pricing (Bug fix earlier
 * today): accept the raw file via multipart formData, parse server-side
 * with ExcelJS (xlsx) or an inline CSV splitter (csv), then hand the
 * row objects to ingestCOGRecordsRows. Rows never cross the wire as RSC.
 */
export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await getHeaders() })
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { success, retryAfterMs } = rateLimit(
      `import-cog:${session.user.id}`,
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

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 })
    }

    const MAX_FILE_SIZE = 100 * 1024 * 1024
    if (file.size > MAX_FILE_SIZE) {
      const mb = (file.size / (1024 * 1024)).toFixed(1)
      return NextResponse.json(
        {
          error: `File is ${mb}MB; max is 100MB. Split the workbook into multiple sheets/files, or export each tab as a separate .csv.`,
        },
        { status: 400 },
      )
    }

    const lowerName = file.name.toLowerCase()
    let rows: Record<string, string>[] = []

    if (lowerName.endsWith(".xlsx")) {
      const arrayBuffer = await file.arrayBuffer()
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
      const headerRow = sheet.getRow(1)
      const rawValues = headerRow.values as (ExcelJS.CellValue | undefined)[]
      const headers: string[] = rawValues
        .slice(1)
        .map((v) => (v != null ? String(v).trim() : ""))
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
    } else if (lowerName.endsWith(".csv")) {
      const text = await file.text()
      const stripped = text.replace(/^﻿/, "")
      const lines = stripped.split(/\r?\n/).filter((l) => l.trim().length > 0)
      if (lines.length <= 1) {
        return NextResponse.json(
          { error: "CSV has no data rows" },
          { status: 400 },
        )
      }
      const splitRow = (line: string): string[] => {
        const out: string[] = []
        let cur = ""
        let inQ = false
        for (let i = 0; i < line.length; i++) {
          const ch = line[i]
          if (ch === '"') {
            if (inQ && line[i + 1] === '"') {
              cur += '"'
              i++
            } else {
              inQ = !inQ
            }
          } else if (ch === "," && !inQ) {
            out.push(cur)
            cur = ""
          } else {
            cur += ch
          }
        }
        out.push(cur)
        return out.map((s) => s.trim())
      }
      const headers = splitRow(lines[0])
      rows = lines.slice(1).map((line) => {
        const cells = splitRow(line)
        const row: Record<string, string> = {}
        for (let j = 0; j < headers.length; j++) {
          row[headers[j]] = cells[j] ?? ""
        }
        return row
      })
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

    const result = await ingestCOGRecordsRows(rows, file.name)
    return NextResponse.json(result)
  } catch (error) {
    console.error("[/api/import-cog]", error)
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
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
