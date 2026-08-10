import { NextResponse } from "next/server"
import { headers as getHeaders } from "next/headers"
import { unstable_rethrow } from "next/navigation"
import { auth } from "@/lib/auth-server"
import { rateLimit } from "@/lib/rate-limit"
import { denyUnlessPortalWriter } from "@/lib/api/import-route-auth"
import { ingestPricingFile } from "@/lib/actions/imports/pricing-import"
import { parseXlsxBufferToRows } from "@/lib/actions/imports/shared"
import { XlsxLimitError } from "@/lib/xlsx/parse-xlsx-bounded"
import { CsvLimitError, parseCsvTextBounded } from "@/lib/csv/parse-csv-bounded"

/**
 * Bug 2026-05-18 (Vick "Primary full COG.xlsx" import failing):
 * MassUpload previously did parse-on-client → send-rows-to-Server-Action,
 * which hit RSC's 1M-array-leaf cap on a 46k-row × 25-col file
 * ("Maximum array nesting exceeded"). Server Actions are the wrong
 * transport for arbitrary tabular uploads — Next.js docs (parse-file/
 * proxyClientMaxBodySize) recommend Route Handlers + `formData()` for
 * file uploads. The file goes up once as multipart, parsing + ingestion
 * happen server-side, and the rows array never leaves the server.
 *
 * Accepts both .xlsx (ExcelJS) and .csv (inline parser, mirrors the
 * client-side one in mass-upload.tsx so behavior is identical).
 *
 * Returns the same shape as `ingestPricingFile` so the MassUpload
 * caller's totalCreated / totalFailed accounting works unchanged.
 */
export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await getHeaders() })
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Role + write-tier gate runs BEFORE any parse work — previously reached
    // only inside ingestPricingFile, after the whole file was parsed.
    const denied = await denyUnlessPortalWriter(session.user.id, "facility")
    if (denied) return denied

    const { success, retryAfterMs } = rateLimit(
      `import-pricing:${session.user.id}`,
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
    const vendorHint = formData.get("vendorHint") as string | null

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
      const parsed = parseCsvTextBounded(text)
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

    // Server-to-server call: no RSC serialization on the action input,
    // so the rows array can be any size (still bounded by memory).
    const result = await ingestPricingFile({
      rows,
      fileName: file.name,
      vendorHint,
    })

    return NextResponse.json(result)
  } catch (error) {
    unstable_rethrow(error)
    console.error("[/api/import-pricing]", error)
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
    return NextResponse.json({ error: "Import failed" }, { status: 500 })
  }
}
