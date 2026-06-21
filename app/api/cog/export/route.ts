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
import type { Prisma, COGMatchStatus } from "@/lib/generated/prisma/client"

const ALLOWED_MATCH_STATUSES: readonly COGMatchStatus[] = [
  "pending",
  "on_contract",
  "off_contract_item",
  "out_of_scope",
  "unknown_vendor",
  "price_variance",
] as const

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

// Parse a query-param date, returning undefined for missing/invalid values
// (an unguarded `new Date("garbage")` yields an Invalid Date that Prisma rejects).
const parseQueryDate = (raw: string | undefined): Date | undefined => {
  if (!raw) return undefined
  const d = new Date(raw)
  return Number.isNaN(d.getTime()) ? undefined : d
}

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
  const vendorId = url.searchParams.get("vendorId") ?? undefined
  const dateFrom = url.searchParams.get("dateFrom") ?? undefined
  const dateTo = url.searchParams.get("dateTo") ?? undefined
  const matchStatusRaw = url.searchParams.get("matchStatus")
  const matchStatus =
    matchStatusRaw &&
    ALLOWED_MATCH_STATUSES.includes(matchStatusRaw as COGMatchStatus)
      ? (matchStatusRaw as COGMatchStatus)
      : undefined

  const conditions: Prisma.COGRecordWhereInput[] = [
    { facilityId: facility.id },
  ]
  if (vendorId) conditions.push({ vendorId })
  const gteDate = parseQueryDate(dateFrom)
  const lteDate = parseQueryDate(dateTo)
  if (gteDate) {
    conditions.push({ transactionDate: { gte: gteDate } })
  }
  if (lteDate) {
    conditions.push({ transactionDate: { lte: lteDate } })
  }
  if (matchStatus === "price_variance" || matchStatus === "off_contract_item") {
    conditions.push({ matchStatus })
  } else if (matchStatus) {
    conditions.push({ matchStatus })
  } else if (matchStatusRaw === "variance_only") {
    // Client maps the "Variance only" quick-filter to this literal. Pull
    // off-contract + price-variance in one query.
    conditions.push({
      matchStatus: { in: ["off_contract_item", "price_variance"] },
    })
  }

  const where: Prisma.COGRecordWhereInput = { AND: conditions }

  // Cap at 100k rows to keep the export within a reasonable memory
  // envelope. Anything larger should use the (future, v2) streaming
  // path called out in the spec.
  const records = await prisma.cOGRecord.findMany({
    where,
    include: { vendor: { select: { name: true } } },
    orderBy: { transactionDate: "desc" },
    take: 100_000,
  })

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
  const filename = `cog-data-${new Date().toISOString().slice(0, 10)}.csv`

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  })
}
