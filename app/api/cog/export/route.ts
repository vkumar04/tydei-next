/**
 * COG data CSV export endpoint — subsystem 8 of the COG data rewrite.
 *
 * Applies the same vendor / match-status / date-range filters the UI
 * exposes, then streams a CSV blob back to the browser. No heavy
 * lifting: this is a thin wrapper over a filtered Prisma query, which
 * keeps the user's current view in sync with the downloaded artifact.
 *
 * Auth: reuses the session helper + facility scope so an operator
 * cannot pull another facility's data by forging query params.
 */

import { NextResponse } from "next/server"
import { headers as getHeaders } from "next/headers"
import { auth } from "@/lib/auth-server"
import { prisma } from "@/lib/db"
import { cogRecordWhere } from "@/lib/contracts/cog-record-filter"

/**
 * Row ceiling for a single export. Kept here (not in the shared filter helper)
 * because it is a property of THIS transport — the table paginates instead.
 * When it bites, the response says so: see the filename and the X-* headers
 * at the bottom of the handler.
 */
const EXPORT_ROW_CAP = 100_000

const CSV_HEADERS = [
  "poNumber",
  "transactionDate",
  "inventoryNumber",
  "inventoryDescription",
  "vendorName",
  "vendorItemNo",
  "manufacturerNo",
  "quantity",
  "unitCost",
  "extendedPrice",
  "contractPrice",
  "savingsAmount",
  "variancePercent",
  "matchStatus",
  "isOnContract",
  "category",
  "notes",
] as const

// RFC 4180 — quote if value contains comma, quote, CR, or LF; escape embedded
// quotes by doubling. PLUS formula-injection defense: COG free-text fields
// (description/category/notes) come from operator-uploaded files, so neutralize
// any leading =,+,-,@,tab,CR by prefixing a single quote before Excel/Sheets
// can evaluate it as a formula (security audit 2026-06-21).
const csvEscape = (raw: unknown): string => {
  if (raw === null || raw === undefined) return ""
  let s = typeof raw === "string" ? raw : String(raw)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

// (Date-param parsing now lives in `cogRecordWhere` — one definition, shared
// with the table's query, including the guard against `new Date("garbage")`.)

const formatDate = (d: Date | null | undefined): string => {
  if (!d) return ""
  // Keep only YYYY-MM-DD so spreadsheets don't try to reinterpret the
  // timestamp with their own timezone offsets.
  return d.toISOString().slice(0, 10)
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await getHeaders() })
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // Verify the user belongs to a facility and scope by that id.
  const member = await prisma.member.findFirst({
    where: { userId: session.user.id },
    include: {
      organization: { include: { facility: true } },
    },
  })
  const facility = member?.organization?.facility
  if (!facility) {
    return NextResponse.json(
      { error: "Facility session required" },
      { status: 403 }
    )
  }

  const url = new URL(request.url)

  // Build the where via the CANONICAL helper, the same one `getCOGRecords`
  // uses to populate the table. This endpoint previously hand-rolled its own
  // copy which silently omitted `search`, so an operator who searched
  // "Stryker", saw 108 rows, and hit Export received all 49,269 facility rows
  // under an identical filename. Two hand-rolled copies of one filter is the
  // bug; there is now one definition and both callers read it.
  //
  // `facility.id` comes from the session below, never from the query string —
  // a forged `facilityId` param is ignored, as it always was.
  const where = cogRecordWhere(facility.id, {
    search: url.searchParams.get("search"),
    vendorId: url.searchParams.get("vendorId"),
    matchStatus: url.searchParams.get("matchStatus"),
    dateFrom: url.searchParams.get("dateFrom"),
    dateTo: url.searchParams.get("dateTo"),
  })

  // Cap at 100k rows to keep the export within a reasonable memory
  // envelope. Anything larger should use the (future, v2) streaming
  // path called out in the spec.
  //
  // Count alongside the read so the cap can be STATED rather than silently
  // applied. An export that is short by 40,000 rows and says nothing is the
  // same defect as the dropped search filter, one layer down.
  const [records, matched] = await Promise.all([
    prisma.cOGRecord.findMany({
      where,
      include: { vendor: { select: { name: true } } },
      orderBy: { transactionDate: "desc" },
      take: EXPORT_ROW_CAP,
    }),
    prisma.cOGRecord.count({ where }),
  ])

  const lines: string[] = [CSV_HEADERS.join(",")]
  for (const r of records) {
    const row: string[] = [
      csvEscape(r.poNumber),
      csvEscape(formatDate(r.transactionDate)),
      csvEscape(r.inventoryNumber),
      csvEscape(r.inventoryDescription),
      csvEscape(r.vendor?.name ?? r.vendorName ?? ""),
      csvEscape(r.vendorItemNo),
      csvEscape(r.manufacturerNo),
      csvEscape(r.quantity),
      csvEscape(r.unitCost?.toString() ?? ""),
      csvEscape(r.extendedPrice?.toString() ?? ""),
      csvEscape(r.contractPrice?.toString() ?? ""),
      csvEscape(r.savingsAmount?.toString() ?? ""),
      csvEscape(r.variancePercent?.toString() ?? ""),
      csvEscape(r.matchStatus),
      csvEscape(r.isOnContract ? "true" : "false"),
      csvEscape(r.category),
      csvEscape(r.notes),
    ]
    lines.push(row.join(","))
  }

  const csv = lines.join("\n")

  // Name the artifact after what is actually in it. The codebase already uses
  // this idiom for the contracts export (`summarizeContractsExport` in
  // hooks/use-contracts.ts): when rows are missing, both numbers go in the
  // filename so the file cannot be mistaken for a complete one after it has
  // been renamed, emailed, or filed away from any UI that could explain it.
  const stamp = new Date().toISOString().slice(0, 10)
  const truncated = records.length < matched
  const filename = truncated
    ? `cog-data-${stamp}-first-${records.length}-of-${matched}.csv`
    : `cog-data-${stamp}.csv`

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
      // Read by the client so the toast can state the scope of the download.
      // `X-Total-Matched` is the server's count for the SAME where clause the
      // rows came from, so the two numbers are comparable.
      "X-Rows-Exported": String(records.length),
      "X-Total-Matched": String(matched),
    },
  })
}
