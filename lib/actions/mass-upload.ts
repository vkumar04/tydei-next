"use server"

import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { logAudit } from "@/lib/audit"
import { serialize } from "@/lib/serialize"
import { matchVendorByAlias } from "@/lib/vendor-aliases"
import type { RichContractExtractData } from "@/lib/ai/schemas"
import type {
  ContractType,
  PerformancePeriod,
  RebateType,
  TermType,
} from "@prisma/client"

// ─── Vendor find-or-create ──────────────────────────────────────

/**
 * Resolve an incoming vendor name to an existing Vendor row, using (in order):
 *   1. exact case-insensitive name match
 *   2. the canonical alias table in lib/vendor-aliases.ts
 *   3. Levenshtein fuzzy match against all existing vendors
 *
 * Only creates a new vendor stub when none of the above yield a hit. This
 * prevents ingest from sharding the Vendor table into near-duplicates like
 * "Stryker" / "Stryker Corp" / "Stryker Orthopaedics".
 */
async function findOrCreateVendorByName(
  name: string | null | undefined,
  division?: string | null
): Promise<string> {
  const trimmed = (name ?? "").trim()
  if (!trimmed) {
    // Last-resort fallback so we always have SOME vendor to attach to.
    const fallback = await prisma.vendor.upsert({
      where: { id: "unknown-vendor-placeholder" },
      update: {},
      create: {
        id: "unknown-vendor-placeholder",
        name: "Unknown Vendor",
        status: "active",
      },
      select: { id: true },
    })
    return fallback.id
  }

  // Exact case-insensitive match first — cheap and covers the happy path.
  const exact = await prisma.vendor.findFirst({
    where: { name: { equals: trimmed, mode: "insensitive" } },
    select: { id: true },
  })
  if (exact) return exact.id

  // Alias + fuzzy match against the full vendor table.
  const vendors = await prisma.vendor.findMany({
    select: { id: true, name: true, displayName: true },
  })
  const aliasHit = matchVendorByAlias(trimmed, vendors)
  if (aliasHit) return aliasHit

  // Still nothing — create a new vendor with the AI-extracted name verbatim.
  const created = await prisma.vendor.create({
    data: {
      name: trimmed,
      division: division?.trim() || null,
      status: "active",
    },
    select: { id: true },
  })
  return created.id
}

// ─── Enum normalizers ───────────────────────────────────────────

function toContractType(v: RichContractExtractData["contractType"]): ContractType {
  const allowed: ContractType[] = [
    "usage",
    "capital",
    "service",
    "tie_in",
    "grouped",
    "pricing_only",
  ]
  return allowed.includes(v as ContractType) ? (v as ContractType) : "usage"
}

function toPerfPeriod(
  v: string | null | undefined
): PerformancePeriod | null {
  if (!v) return null
  const allowed: PerformancePeriod[] = [
    "monthly",
    "quarterly",
    "semi_annual",
    "annual",
  ]
  return allowed.includes(v as PerformancePeriod)
    ? (v as PerformancePeriod)
    : null
}

function toTermType(v: string | null | undefined): TermType {
  if (!v) return "spend_rebate"
  const allowed: TermType[] = [
    "spend_rebate",
    "volume_rebate",
    "price_reduction",
    "po_rebate",
    "carve_out",
    "market_share",
    "market_share_price_reduction",
    "capitated_price_reduction",
    "capitated_pricing_rebate",
    "payment_rebate",
    "growth_rebate",
    "compliance_rebate",
    "fixed_fee",
    "locked_pricing",
    "rebate_per_use",
  ]
  return allowed.includes(v as TermType) ? (v as TermType) : "spend_rebate"
}

function toRebateType(v: string | null | undefined): RebateType {
  if (!v) return "percent_of_spend"
  const allowed: RebateType[] = [
    "percent_of_spend",
    "fixed_rebate",
    "fixed_rebate_per_unit",
    "per_procedure_rebate",
  ]
  return allowed.includes(v as RebateType) ? (v as RebateType) : "percent_of_spend"
}

function toSafeDate(input: string | null | undefined, fallback: Date): Date {
  if (!input) return fallback
  const d = new Date(input)
  return Number.isNaN(d.getTime()) ? fallback : d
}

// ─── Ingest a single extracted contract ─────────────────────────

export type IngestContractInput = {
  extracted: RichContractExtractData
  sourceFilename?: string
  s3Key?: string
}

export type IngestContractResult =
  | { ok: true; contractId: string; name: string }
  | { ok: false; error: string; name: string }

export async function ingestExtractedContracts(
  items: IngestContractInput[]
): Promise<{
  created: number
  failed: number
  results: IngestContractResult[]
}> {
  const session = await requireFacility()
  const facilityId = session.facility.id
  const userId = session.user.id

  const results: IngestContractResult[] = []

  for (const item of items) {
    const { extracted, sourceFilename } = item
    const displayName =
      extracted.contractName ||
      sourceFilename?.replace(/\.[^/.]+$/, "").replace(/[-_]/g, " ") ||
      "Untitled Contract"

    try {
      const vendorId = await findOrCreateVendorByName(
        extracted.vendorName,
        extracted.vendorDivision
      )

      const today = new Date()
      const inOneYear = new Date(today.getFullYear() + 1, today.getMonth(), today.getDate())
      const effectiveDate = toSafeDate(extracted.effectiveDate, today)
      const expirationDate = toSafeDate(extracted.expirationDate, inOneYear)

      const contract = await prisma.contract.create({
        data: {
          name: displayName,
          contractNumber: extracted.contractId ?? null,
          vendorId,
          facilityId,
          contractType: toContractType(extracted.contractType),
          status: "active",
          effectiveDate,
          expirationDate,
          totalValue: extracted.tieInDetails?.capitalEquipmentValue ?? 0,
          description:
            extracted.specialConditions && extracted.specialConditions.length > 0
              ? extracted.specialConditions.join(" · ")
              : null,
          rebatePayPeriod: toPerfPeriod(extracted.rebatePayPeriod) ?? "quarterly",
          isGrouped: extracted.isGroupedContract ?? false,
          isMultiFacility:
            (extracted.facilities && extracted.facilities.length > 1) ?? false,
          createdById: userId,
          contractFacilities: {
            create: [{ facilityId }],
          },
          ...(extracted.terms && extracted.terms.length > 0
            ? {
                terms: {
                  create: extracted.terms.map((term) => ({
                    termName: term.termName,
                    termType: toTermType(term.termType),
                    effectiveStart: toSafeDate(term.effectiveFrom, effectiveDate),
                    effectiveEnd: toSafeDate(term.effectiveTo, expirationDate),
                    // ContractTerm doesn't store a performancePeriod enum — it
                    // tracks cadence in free-text evaluationPeriod/paymentTiming.
                    evaluationPeriod: term.performancePeriod ?? "annual",
                    paymentTiming: extracted.rebatePayPeriod ?? "quarterly",
                    ...(term.tiers && term.tiers.length > 0
                      ? {
                          tiers: {
                            create: term.tiers.map((tier) => ({
                              tierNumber: tier.tierNumber ?? 1,
                              spendMin: tier.spendMin ?? 0,
                              spendMax: tier.spendMax ?? null,
                              volumeMin: tier.volumeMin ?? null,
                              volumeMax: tier.volumeMax ?? null,
                              marketShareMin: tier.marketShareMin ?? null,
                              marketShareMax: tier.marketShareMax ?? null,
                              rebateType: toRebateType(tier.rebateType),
                              rebateValue: tier.rebateValue ?? 0,
                            })),
                          },
                        }
                      : {}),
                  })),
                },
              }
            : {}),
        },
        select: { id: true, name: true },
      })

      await logAudit({
        userId,
        action: "contract.imported_via_mass_upload",
        entityType: "contract",
        entityId: contract.id,
        metadata: {
          vendorName: extracted.vendorName,
          sourceFilename: sourceFilename ?? null,
        },
      })

      results.push({ ok: true, contractId: contract.id, name: contract.name })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error("[ingestExtractedContracts] failure:", err)
      results.push({ ok: false, error: message.slice(0, 4000), name: displayName })
    }
  }

  revalidatePath("/dashboard/contracts")
  revalidatePath("/dashboard")

  const created = results.filter((r) => r.ok).length
  const failed = results.length - created
  return serialize({ created, failed, results })
}

// ─── Ingest extracted invoices (minimal) ────────────────────────

export type IngestInvoiceInput = {
  invoiceNumber: string | null
  vendorName: string | null
  invoiceDate: string | null
  totalAmount: number | null
  sourceFilename?: string
}

export type IngestInvoiceResult =
  | { ok: true; invoiceId: string; invoiceNumber: string }
  | { ok: false; error: string; invoiceNumber: string }

export async function ingestExtractedInvoices(
  items: IngestInvoiceInput[]
): Promise<{
  created: number
  failed: number
  results: IngestInvoiceResult[]
}> {
  const session = await requireFacility()
  const facilityId = session.facility.id
  const userId = session.user.id

  const results: IngestInvoiceResult[] = []

  for (const item of items) {
    const displayNumber =
      item.invoiceNumber ||
      item.sourceFilename?.replace(/\.[^/.]+$/, "") ||
      `INV-${Date.now()}-${results.length}`

    try {
      const vendorId = await findOrCreateVendorByName(item.vendorName)
      const invoiceDate = toSafeDate(item.invoiceDate, new Date())

      const invoice = await prisma.invoice.create({
        data: {
          invoiceNumber: displayNumber,
          facilityId,
          vendorId,
          invoiceDate,
          totalInvoiceCost: item.totalAmount ?? 0,
          status: "pending",
        },
        select: { id: true, invoiceNumber: true },
      })

      await logAudit({
        userId,
        action: "invoice.imported_via_mass_upload",
        entityType: "invoice",
        entityId: invoice.id,
        metadata: {
          vendorName: item.vendorName,
          sourceFilename: item.sourceFilename ?? null,
        },
      })

      results.push({
        ok: true,
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      results.push({ ok: false, error: message.slice(0, 200), invoiceNumber: displayNumber })
    }
  }

  revalidatePath("/dashboard/invoice-validation")
  revalidatePath("/dashboard")

  const created = results.filter((r) => r.ok).length
  const failed = results.length - created
  return serialize({ created, failed, results })
}

// ─── CSV parser (minimal, header-aware) ─────────────────────────

/**
 * Parse a CSV string into an array of row objects keyed by header. Handles
 * BOMs, CRLF line endings, and quoted fields containing commas. No deps.
 */
function parseCSV(text: string): Record<string, string>[] {
  const stripped = text.replace(/^\uFEFF/, "") // drop BOM
  const lines = stripped.split(/\r?\n/).filter((l) => l.trim().length > 0)
  if (lines.length === 0) return []

  const splitRow = (line: string): string[] => {
    const out: string[] = []
    let cur = ""
    let inQuotes = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"'
          i++
        } else {
          inQuotes = !inQuotes
        }
      } else if (ch === "," && !inQuotes) {
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
  const rows: Record<string, string>[] = []
  for (let i = 1; i < lines.length; i++) {
    const cells = splitRow(lines[i])
    const row: Record<string, string> = {}
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = cells[j] ?? ""
    }
    rows.push(row)
  }
  return rows
}

/** Trim + strip "$ 205.00" / "$205.00" / "205.00" / "" → number. */
function parseMoney(raw: string | undefined): number {
  if (!raw) return 0
  const cleaned = raw.replace(/[$,\s]/g, "").replace(/[()]/g, "")
  if (!cleaned || cleaned === "-") return 0
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : 0
}

/** Parse MM/DD/YYYY or YYYY-MM-DD or MM/DD/YYYY HH:MM → Date. */
function parseDate(raw: string | undefined): Date | null {
  if (!raw) return null
  const cleaned = raw.trim().split(" ")[0] // drop time component if present
  if (!cleaned || cleaned === "-") return null
  // MM/DD/YYYY
  const usMatch = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (usMatch) {
    const [, m, d, y] = usMatch
    return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)))
  }
  // YYYY-MM-DD
  const isoMatch = cleaned.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (isoMatch) {
    const [, y, m, d] = isoMatch
    return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)))
  }
  const direct = new Date(cleaned)
  return Number.isNaN(direct.getTime()) ? null : direct
}

// ─── Ingest Patient Case Data CSV ───────────────────────────────
//
// Expects columns from the Lighthouse "Patient Fields" export:
//   Patient MRN, Case ID, Facility Name, Date of birth, Surgeon,
//   Date of Surgery, OR Name, Time wheeled into OR, Time wheeled out of OR
// Upserts Case rows keyed on caseNumber = Case ID. Does not touch
// totalSpend / totalReimbursement — those come from the supply ingest.

export async function ingestCaseDataCSV(
  csvText: string,
  fileName?: string
): Promise<{ created: number; updated: number; failed: number; errors: string[] }> {
  const session = await requireFacility()
  const facilityId = session.facility.id
  const userId = session.user.id

  const rows = parseCSV(csvText)
  let created = 0
  let updated = 0
  let failed = 0
  const errors: string[] = []

  for (const row of rows) {
    const caseNumber = (row["Case ID"] ?? "").trim()
    if (!caseNumber) {
      failed++
      continue
    }

    const surgeryDate = parseDate(row["Date of Surgery"])
    if (!surgeryDate) {
      failed++
      errors.push(`${caseNumber}: invalid Date of Surgery`)
      continue
    }

    const patientDob = parseDate(row["Date of birth"])
    const surgeonName = (row["Surgeon"] ?? "").trim() || null
    const timeIn = (row["Time wheeled into OR"] ?? "").trim() || null
    const timeOut = (row["Time wheeled out of OR"] ?? "").trim() || null

    try {
      const existing = await prisma.case.findUnique({
        where: { caseNumber },
        select: { id: true },
      })
      await prisma.case.upsert({
        where: { caseNumber },
        update: {
          facilityId,
          surgeonName,
          patientDob,
          dateOfSurgery: surgeryDate,
          timeInOr: timeIn,
          timeOutOr: timeOut,
        },
        create: {
          caseNumber,
          facilityId,
          surgeonName,
          patientDob,
          dateOfSurgery: surgeryDate,
          timeInOr: timeIn,
          timeOutOr: timeOut,
        },
      })
      if (existing) updated++
      else created++
    } catch (err) {
      failed++
      const message = err instanceof Error ? err.message : String(err)
      errors.push(`${caseNumber}: ${message.slice(0, 160)}`)
    }
  }

  await logAudit({
    userId,
    action: "cases.imported_via_mass_upload",
    entityType: "case",
    metadata: { created, updated, failed, rowCount: rows.length, fileName: fileName ?? null },
  })

  revalidatePath("/dashboard/case-costing")
  return { created, updated, failed, errors: errors.slice(0, 10) }
}

// ─── Ingest Case Procedures CSV ─────────────────────────────────
//
// Expects columns: Case ID, Date of Surgery, CPT Code, CPT Is Primary YN,
// Procedure Sequence. Upserts a minimal Case row if one doesn't exist
// yet (so procedures can land before the patient-fields CSV is ingested),
// then attaches a CaseProcedure per row. Sets Case.primaryCptCode when
// CPT Is Primary = Y.

export async function ingestCaseProceduresCSV(
  csvText: string,
  fileName?: string
): Promise<{ created: number; failed: number; caseStubsCreated: number; errors: string[] }> {
  const session = await requireFacility()
  const facilityId = session.facility.id
  const userId = session.user.id

  const rows = parseCSV(csvText)
  let created = 0
  let failed = 0
  let caseStubsCreated = 0
  const errors: string[] = []

  for (const row of rows) {
    const caseNumber = (row["Case ID"] ?? "").trim()
    const cptCode = (row["CPT Code"] ?? "").trim()
    if (!caseNumber || !cptCode) {
      failed++
      continue
    }
    const isPrimary = (row["CPT Is Primary YN"] ?? "").trim().toUpperCase() === "Y"
    const surgeryDate = parseDate(row["Date of Surgery"])

    try {
      // Ensure a parent Case row exists. If the patient-fields CSV hasn't
      // been ingested yet, create a stub with surgery date only.
      let caseRow = await prisma.case.findUnique({
        where: { caseNumber },
        select: { id: true },
      })
      if (!caseRow) {
        if (!surgeryDate) {
          failed++
          errors.push(`${caseNumber}: no surgery date and no existing case`)
          continue
        }
        caseRow = await prisma.case.create({
          data: {
            caseNumber,
            facilityId,
            dateOfSurgery: surgeryDate,
          },
          select: { id: true },
        })
        caseStubsCreated++
      }

      await prisma.caseProcedure.create({
        data: {
          caseId: caseRow.id,
          cptCode,
        },
      })
      if (isPrimary) {
        await prisma.case.update({
          where: { id: caseRow.id },
          data: { primaryCptCode: cptCode },
        })
      }
      created++
    } catch (err) {
      failed++
      const message = err instanceof Error ? err.message : String(err)
      errors.push(`${caseNumber}/${cptCode}: ${message.slice(0, 160)}`)
    }
  }

  await logAudit({
    userId,
    action: "case_procedures.imported_via_mass_upload",
    entityType: "case_procedure",
    metadata: { created, failed, caseStubsCreated, rowCount: rows.length, fileName: fileName ?? null },
  })

  revalidatePath("/dashboard/case-costing")
  return { created, failed, caseStubsCreated, errors: errors.slice(0, 10) }
}

