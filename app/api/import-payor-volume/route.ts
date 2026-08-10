import { NextResponse } from "next/server"
import { headers as getHeaders } from "next/headers"
import { unstable_rethrow } from "next/navigation"
import { auth } from "@/lib/auth-server"
import { rateLimit } from "@/lib/rate-limit"
import { denyUnlessPortalWriter } from "@/lib/api/import-route-auth"
import { ingestPayorVolumeRows } from "@/lib/actions/payor-volume"
import { parseXlsxBufferToRows } from "@/lib/actions/imports/shared"
import { XlsxLimitError } from "@/lib/xlsx/parse-xlsx-bounded"
import { CsvLimitError, parseCsvTextBounded } from "@/lib/csv/parse-csv-bounded"

// Tighter than the shared defaults: a payor volume file is four columns
// (Procedure Group, Year, Quarter, Volume) and the ingest action caps at
// 50k rows anyway — reject before building row objects, not after.
const MAX_CSV_DATA_ROWS = 50_000
const MAX_CSV_COLUMNS = 64

/**
 * Payor-volume upload for the vendor Dividend/DCF tab. Same shape as
 * /api/import-cog: the raw file arrives via multipart formData and is parsed
 * server-side (bounded xlsx parse / inline CSV splitter) — file bytes never
 * cross the RSC wire as a Server Action argument. Row objects then go to
 * `ingestPayorVolumeRows`, which does requireVendor/requireCanMutate + the
 * Prisma write.
 */
export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await getHeaders() })
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Role + write-tier gate runs BEFORE any parse work so facility-portal
    // and read-only users can't drive server-side file parsing at all. The
    // action re-checks both (defense in depth).
    const denied = await denyUnlessPortalWriter(session.user.id, "vendor")
    if (denied) return denied

    const { success, retryAfterMs } = rateLimit(
      `import-payor-volume:${session.user.id}`,
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

    const MAX_FILE_SIZE = 20 * 1024 * 1024
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "File is too large; payor volume files should be under 20MB." },
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
        maxRows: MAX_CSV_DATA_ROWS,
        maxColumns: MAX_CSV_COLUMNS,
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

    const result = await ingestPayorVolumeRows(rows, {
      fileName: file.name,
      facilityId: typeof facilityId === "string" && facilityId ? facilityId : undefined,
      adhocName:
        typeof adhocName === "string" && adhocName.trim()
          ? adhocName.trim()
          : undefined,
    })
    return NextResponse.json(result)
  } catch (error) {
    unstable_rethrow(error)
    console.error("[/api/import-payor-volume]", error)
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
    // Action-level validation errors (facility, columns, caps) are safe to
    // surface verbatim; anything else stays generic.
    const KNOWN = [
      "Facility not found",
      "No procedure groups found",
      "rows; max is",
      "procedure groups; max is",
      "no data rows",
      "Provide exactly one",
    ]
    if (KNOWN.some((k) => message.includes(k))) {
      return NextResponse.json({ error: message }, { status: 400 })
    }
    return NextResponse.json({ error: "Import failed" }, { status: 500 })
  }
}
