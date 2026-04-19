/**
 * Contract pricing CSV export — Charles R5.14.
 *
 * Streams all ContractPricing rows for a given contract as a CSV. Scoped
 * to the caller's facility: we verify the contract belongs to the
 * session's facility before returning any data, so a forged `id` in the
 * URL cannot leak another facility's pricing.
 *
 * Mirrors the shape of `app/api/cog/export/route.ts`.
 */

import { NextResponse } from "next/server"
import { headers as getHeaders } from "next/headers"
import { auth } from "@/lib/auth-server"
import { prisma } from "@/lib/db"

const CSV_HEADERS = [
  "vendorItemNo",
  "description",
  "category",
  "unitPrice",
  "listPrice",
  "uom",
  "effectiveDate",
  "expirationDate",
] as const

// RFC 4180 — quote if value contains comma, quote, CR, or LF; double
// embedded quotes.
const csvEscape = (raw: unknown): string => {
  if (raw === null || raw === undefined) return ""
  const s = typeof raw === "string" ? raw : String(raw)
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

const formatDate = (d: Date | null | undefined): string => {
  if (!d) return ""
  return d.toISOString().slice(0, 10)
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  const session = await auth.api.getSession({ headers: await getHeaders() })
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const member = await prisma.member.findFirst({
    where: { userId: session.user.id },
    include: { organization: { include: { facility: true } } },
  })
  const facility = member?.organization?.facility
  if (!facility) {
    return NextResponse.json(
      { error: "Facility session required" },
      { status: 403 },
    )
  }

  // Ensure the contract belongs to the caller's facility before reading
  // any pricing rows.
  const contract = await prisma.contract.findFirst({
    where: { id, facilityId: facility.id },
    select: { id: true },
  })
  if (!contract) {
    return NextResponse.json({ error: "Not found" }, { status: 403 })
  }

  const rows = await prisma.contractPricing.findMany({
    where: { contractId: id },
    orderBy: [{ category: "asc" }, { vendorItemNo: "asc" }],
  })

  const lines: string[] = [CSV_HEADERS.join(",")]
  for (const r of rows) {
    lines.push(
      [
        csvEscape(r.vendorItemNo),
        csvEscape(r.description),
        csvEscape(r.category),
        csvEscape(r.unitPrice?.toString() ?? ""),
        csvEscape(r.listPrice?.toString() ?? ""),
        csvEscape(r.uom),
        csvEscape(formatDate(r.effectiveDate)),
        csvEscape(formatDate(r.expirationDate)),
      ].join(","),
    )
  }

  const csv = lines.join("\n")
  const filename = `contract-${id}-pricing-${new Date()
    .toISOString()
    .slice(0, 10)}.csv`

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  })
}
