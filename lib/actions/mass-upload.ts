"use server"

import { generateText, Output } from "ai"
import { z } from "zod"
import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { logAudit } from "@/lib/audit"
import { serialize } from "@/lib/serialize"
import { resolveVendorId } from "@/lib/vendors/resolve"
import { bulkImportCOGRecords } from "@/lib/actions/cog-import"
import { claudeModel } from "@/lib/ai/config"
import type { RichContractExtractData } from "@/lib/ai/schemas"
import type {
  ContractType,
  PerformancePeriod,
  RebateType,
  TermType,
} from "@prisma/client"

// ─── Gemini-backed column mapper ────────────────────────────────
//
// Instead of hardcoding every possible header alias ("ReferenceNumber",
// "Product Catgory" [sic], etc.), we ask Gemini to semantically map the
// caller's source CSV/Excel headers to a target schema. Falls back to a
// best-effort fuzzy match when the model is unavailable (rate limited,
// transient error, no API key).

export type TargetField = { key: string; label: string; required: boolean }

async function mapColumnsWithGemini(
  sourceHeaders: string[],
  targetFields: TargetField[],
  sampleRows: Record<string, string>[]
): Promise<Record<string, string>> {
  try {
    const mappingShape: Record<string, z.ZodTypeAny> = {}
    for (const field of targetFields) {
      mappingShape[field.key] = z
        .string()
        .describe(
          `The source column header that best maps to "${field.label}". Return "" if no source column matches.`
        )
    }
    const schema = z.object(mappingShape)

    const sampleContext = sampleRows.slice(0, 3).length
      ? `\n\nSample data rows (for disambiguation):\n${sampleRows
          .slice(0, 3)
          .map((r) =>
            Object.entries(r)
              .map(([k, v]) => `${k}: ${v}`)
              .join(" | ")
          )
          .join("\n")}`
      : ""

    const targetList = targetFields
      .map((f) => `- ${f.key} ("${f.label}")${f.required ? " [REQUIRED]" : ""}`)
      .join("\n")

    const result = await generateText({
      model: claudeModel,
      output: Output.object({ schema }),
      prompt: `You are a data mapping assistant. Match each target field to the most likely source column header. Be tolerant of typos, capitalization, spacing, abbreviations, and non-English labels. Return "" for any target that has no reasonable match.

Source headers:
${sourceHeaders.map((h) => `- "${h}"`).join("\n")}

Target fields:
${targetList}${sampleContext}

Return a mapping object with one entry per target field.`,
    })

    const mapping = result.output as Record<string, string>
    // Filter out empty strings so the caller can test for presence.
    const clean: Record<string, string> = {}
    for (const [k, v] of Object.entries(mapping)) {
      if (v && sourceHeaders.includes(v)) clean[k] = v
    }
    return clean
  } catch (err) {
    console.warn("[mapColumnsWithGemini] falling back to local match:", err)
    return localFallbackMap(sourceHeaders, targetFields)
  }
}

const NORM = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "")

function localFallbackMap(
  headers: string[],
  targetFields: TargetField[]
): Record<string, string> {
  const mapping: Record<string, string> = {}
  for (const field of targetFields) {
    const k = NORM(field.key)
    const l = NORM(field.label)
    const match = headers.find((h) => {
      const n = NORM(h)
      return n === k || n === l || n.includes(k) || n.includes(l)
    })
    if (match) mapping[field.key] = match
  }
  return mapping
}

/** Get a field value from a row using the resolved column mapping. */
function get(
  row: Record<string, string>,
  mapping: Record<string, string>,
  key: string
): string {
  const col = mapping[key]
  if (!col) return ""
  return (row[col] ?? "").trim()
}

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
/**
 * Thin wrapper over the shared resolver so the AI-contract-ingest
 * path can also persist a `division` field on newly-created vendors.
 * Shared logic (exact → alias → fuzzy → create) lives in
 * `lib/vendors/resolve.ts`.
 */
async function findOrCreateVendorByName(
  name: string | null | undefined,
  division?: string | null
): Promise<string> {
  const id = await resolveVendorId(name)
  // resolveVendorId creates a vendor with default fields. If we have
  // a division to set and the vendor was freshly minted (name matches
  // exactly and no division on the row yet), patch it.
  if (id && division?.trim()) {
    await prisma.vendor.update({
      where: { id },
      data: { division: division.trim() },
    }).catch(() => {})
  }
  return id!
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
  if (rows.length === 0) return { created: 0, updated: 0, failed: 0, errors: ["empty file"] }

  const headers = Object.keys(rows[0])
  const mapping = await mapColumnsWithGemini(
    headers,
    [
      { key: "caseNumber", label: "Case ID / Case Number", required: true },
      { key: "surgeryDate", label: "Date of Surgery", required: true },
      { key: "surgeonName", label: "Surgeon — accept any column whose header contains 'surgeon' or 'physician' or 'doctor' or 'provider'", required: false },
      { key: "patientDob", label: "Patient Date of Birth", required: false },
      { key: "timeIn", label: "Time wheeled into OR / Incision Time", required: false },
      { key: "timeOut", label: "Time wheeled out of OR / Closure Time", required: false },
    ],
    rows
  )

  let created = 0
  let updated = 0
  let failed = 0
  const errors: string[] = []

  for (const row of rows) {
    const caseNumber = get(row, mapping, "caseNumber")
    if (!caseNumber) {
      failed++
      continue
    }

    const surgeryDate = parseDate(get(row, mapping, "surgeryDate"))
    if (!surgeryDate) {
      failed++
      errors.push(`${caseNumber}: invalid surgery date`)
      continue
    }

    const patientDob = parseDate(get(row, mapping, "patientDob"))
    // Fallback surgeon resolution when Gemini misses the column: walk
    // every row key looking for something that obviously looks like a
    // name column. Rows with just "Smith, John" or "Dr. Jane Doe"
    // still get captured so the margin table doesn't render
    // "Unknown Surgeon".
    let surgeonName: string | null = get(row, mapping, "surgeonName") || null
    if (!surgeonName) {
      for (const [key, val] of Object.entries(row)) {
        const lowerKey = key.toLowerCase()
        if (
          (lowerKey.includes("surgeon") ||
            lowerKey.includes("physician") ||
            lowerKey.includes("doctor") ||
            lowerKey.includes("provider")) &&
          val &&
          val.trim().length > 0
        ) {
          surgeonName = val.trim()
          break
        }
      }
    }
    const timeIn = get(row, mapping, "timeIn") || null
    const timeOut = get(row, mapping, "timeOut") || null

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
  if (rows.length === 0) return { created: 0, failed: 0, caseStubsCreated: 0, errors: ["empty file"] }

  const headers = Object.keys(rows[0])
  const mapping = await mapColumnsWithGemini(
    headers,
    [
      { key: "caseNumber", label: "Case ID / Case Number", required: true },
      { key: "cptCode", label: "CPT Code / Procedure Code", required: true },
      { key: "isPrimary", label: "CPT Is Primary YN / Primary Procedure Flag", required: false },
      { key: "surgeryDate", label: "Date of Surgery", required: false },
    ],
    rows
  )

  let created = 0
  let failed = 0
  let caseStubsCreated = 0
  const errors: string[] = []

  for (const row of rows) {
    const caseNumber = get(row, mapping, "caseNumber")
    const cptCode = get(row, mapping, "cptCode")
    if (!caseNumber || !cptCode) {
      failed++
      continue
    }
    const isPrimary = get(row, mapping, "isPrimary").toUpperCase().startsWith("Y")
    const surgeryDate = parseDate(get(row, mapping, "surgeryDate"))

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

// ─── Ingest Case Supplies CSV ───────────────────────────────────
//
// Expects Lighthouse "Supply Fields" columns: Patient MRN, Case ID,
// Business Entity, Manufacturer, Material Name, Unit Cost, Catalog
// number, Model #, Serial #, Quantity Used, Used Cost. Each row
// becomes a CaseSupply row linked to its parent Case (upserted by
// caseNumber). Updates Case.totalSpend from the aggregated supply
// cost once all rows land.

export async function ingestCaseSuppliesCSV(
  csvText: string,
  fileName?: string
): Promise<{ created: number; failed: number; casesTouched: number; errors: string[] }> {
  const session = await requireFacility()
  const facilityId = session.facility.id
  const userId = session.user.id

  const rows = parseCSV(csvText)
  if (rows.length === 0)
    return { created: 0, failed: 0, casesTouched: 0, errors: ["empty file"] }

  const headers = Object.keys(rows[0])
  const mapping = await mapColumnsWithGemini(
    headers,
    [
      { key: "caseNumber", label: "Case ID / Case Number", required: true },
      { key: "materialName", label: "Material Name / Product Description", required: true },
      { key: "vendorItemNo", label: "Catalog Number / Vendor Item Number", required: false },
      { key: "unitCost", label: "Unit Cost / Per-Unit Price", required: false },
      { key: "usedCost", label: "Used Cost / Total Line Cost", required: false },
      { key: "quantity", label: "Quantity Used / Count", required: false },
      { key: "manufacturer", label: "Manufacturer", required: false },
    ],
    rows
  )

  let created = 0
  let failed = 0
  const errors: string[] = []
  const caseIdsTouched = new Set<string>()

  for (const row of rows) {
    const caseNumber = get(row, mapping, "caseNumber")
    if (!caseNumber) {
      failed++
      continue
    }

    const materialName = get(row, mapping, "materialName") || "Unknown material"
    const vendorItemNo = get(row, mapping, "vendorItemNo") || null
    const usedCost = parseMoney(get(row, mapping, "usedCost")) || parseMoney(get(row, mapping, "unitCost"))
    const unitCost = parseMoney(get(row, mapping, "unitCost"))
    const quantity = Math.max(1, parseInt(get(row, mapping, "quantity") || "1", 10) || 1)

    try {
      let caseRow = await prisma.case.findUnique({
        where: { caseNumber },
        select: { id: true },
      })
      if (!caseRow) {
        // Stub so supplies can land before the patient CSV.
        caseRow = await prisma.case.create({
          data: {
            caseNumber,
            facilityId,
            dateOfSurgery: new Date(), // placeholder — patient CSV will overwrite
          },
          select: { id: true },
        })
      }
      caseIdsTouched.add(caseRow.id)

      const extCost = usedCost || unitCost * quantity
      await prisma.caseSupply.create({
        data: {
          caseId: caseRow.id,
          materialName,
          vendorItemNo,
          usedCost: extCost || 0,
          quantity,
          extendedCost: extCost || 0,
        },
      })
      created++
    } catch (err) {
      failed++
      const message = err instanceof Error ? err.message : String(err)
      errors.push(`${caseNumber}: ${message.slice(0, 160)}`)
    }
  }

  // Roll up totalSpend on every touched case from the sum of its supplies.
  for (const caseId of caseIdsTouched) {
    const agg = await prisma.caseSupply.aggregate({
      where: { caseId },
      _sum: { extendedCost: true },
    })
    const total = agg._sum.extendedCost ?? 0
    await prisma.case.update({
      where: { id: caseId },
      data: { totalSpend: total, margin: { decrement: 0 } },
    })
  }

  await logAudit({
    userId,
    action: "case_supplies.imported_via_mass_upload",
    entityType: "case_supply",
    metadata: {
      created,
      failed,
      casesTouched: caseIdsTouched.size,
      rowCount: rows.length,
      fileName: fileName ?? null,
    },
  })

  revalidatePath("/dashboard/case-costing")
  return { created, failed, casesTouched: caseIdsTouched.size, errors: errors.slice(0, 10) }
}

// ─── Ingest COG Records CSV ─────────────────────────────────────
//
// Expects the v0 COG export shape: Vendor, Purchase Order Number,
// Date Ordered, product name, Product ref number, Quantity Ordered,
// Unit Cost, Extended Cost. Delegates to bulkImportCOGRecords which
// already handles vendor find-or-create.

export async function ingestCOGRecordsCSV(
  csvText: string,
  fileName?: string
): Promise<{ imported: number; skipped: number; errors: number }> {
  const rows = parseCSV(csvText)
  if (rows.length === 0) return { imported: 0, skipped: 0, errors: 0 }

  const headers = Object.keys(rows[0])
  const mapping = await mapColumnsWithGemini(
    headers,
    [
      { key: "vendorName", label: "Vendor / Supplier Name", required: true },
      { key: "transactionDate", label: "Date Ordered / Transaction Date", required: true },
      { key: "description", label: "Product Name / Item Description", required: false },
      { key: "refNumber", label: "Catalog / Product Reference / Vendor Item Number", required: false },
      { key: "quantity", label: "Quantity Ordered", required: false },
      { key: "unitCost", label: "Unit Cost / Unit Price", required: false },
      { key: "extended", label: "Extended Cost / Total Line Cost", required: false },
      { key: "poNumber", label: "Purchase Order Number", required: false },
    ],
    rows
  )

  const records = rows
    .map((row) => {
      const vendorName = get(row, mapping, "vendorName")
      const transactionDate = parseDate(get(row, mapping, "transactionDate"))
      if (!vendorName || !transactionDate) return null

      const description = get(row, mapping, "description")
      const refNumber = get(row, mapping, "refNumber")
      const quantity = parseInt(get(row, mapping, "quantity") || "1", 10) || 1
      const unitCost = parseMoney(get(row, mapping, "unitCost"))
      const extended =
        parseMoney(get(row, mapping, "extended")) || unitCost * quantity

      const poNumber = get(row, mapping, "poNumber") || undefined

      return {
        vendorName,
        inventoryNumber: refNumber || description || vendorName || "Unknown",
        inventoryDescription: description || refNumber || "Unknown item",
        vendorItemNo: refNumber || undefined,
        poNumber,
        unitCost,
        extendedPrice: extended,
        quantity,
        transactionDate: transactionDate.toISOString(),
      }
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)

  if (records.length === 0) {
    return { imported: 0, skipped: rows.length, errors: 0 }
  }

  const session = await requireFacility()
  const result = await bulkImportCOGRecords({
    facilityId: session.facility.id,
    records,
    duplicateStrategy: "skip",
  })
  await logAudit({
    userId: session.user.id,
    action: "cog.imported_via_mass_upload",
    entityType: "cog_record",
    metadata: { ...result, fileName: fileName ?? null, rowCount: rows.length },
  })
  revalidatePath("/dashboard/cog-data")
  return result
}

// ─── Ingest Pricing File (CSV or pre-parsed xlsx rows) ──────────
//
// Accepts either CSV text or already-parsed rows (for xlsx files the
// client should POST to /api/parse-file first and feed the result in).
// Tries to infer vendor from filename first (via alias matching), then
// falls back to a "Manufacturer" column if present. Creates a PricingFile
// row per item and attaches them to the resolved vendor.

export async function ingestPricingFile(input: {
  rows: Record<string, string>[]
  fileName?: string
  vendorHint?: string | null
}): Promise<{ imported: number; failed: number; vendorUsed: string | null }> {
  const session = await requireFacility()
  const facilityId = session.facility.id
  const userId = session.user.id

  // Vendor resolution: filename hint first (match vendor.code + full name),
  // then Manufacturer column, then Unknown fallback.
  const hint = input.vendorHint ?? input.fileName ?? ""
  let vendorId: string | null = null

  if (hint) {
    const vendors = await prisma.vendor.findMany({
      select: { id: true, name: true, displayName: true, code: true },
    })
    const lowerHint = hint.toLowerCase()

    // Pass 1: match vendor.code (e.g. "ART" → Arthrex, "MDT" → Medtronic).
    // Check codes first because codes are specific (3-4 chars) and
    // unambiguous — the filename "CogsART01012024" encodes the vendor as
    // the "ART" segment.
    for (const v of vendors) {
      if (!v.code) continue
      const code = v.code.toLowerCase()
      if (code.length >= 2 && lowerHint.includes(code)) {
        vendorId = v.id
        break
      }
    }

    // Pass 2: fallback to full-name token match. Skip vendors whose name
    // could false-positive on common filename fragments like "cog".
    if (!vendorId) {
      const SKIP_TOKENS = new Set(["cog", "the", "inc", "llc", "corp", "co"])
      for (const v of vendors) {
        const candidates = [v.name, v.displayName].filter(Boolean) as string[]
        for (const c of candidates) {
          const token = c.toLowerCase().split(/\s+/)[0]
          if (SKIP_TOKENS.has(token)) continue
          if (token.length >= 4 && lowerHint.includes(token)) {
            vendorId = v.id
            break
          }
        }
        if (vendorId) break
      }
    }
  }

  if (!vendorId && input.rows.length > 0) {
    const firstRow = input.rows[0]
    const maybeVendor =
      firstRow["Manufacturer"] ?? firstRow["Vendor"] ?? firstRow["manufacturer"] ?? ""
    if (maybeVendor.trim()) {
      vendorId = await findOrCreateVendorByName(maybeVendor.trim())
    }
  }

  if (!vendorId) {
    vendorId = await findOrCreateVendorByName(null)
  }

  let imported = 0
  let failed = 0

  // AI-driven column mapping — replaces hardcoded alias lists so
  // typo'd or customer-specific headers ("Product Catgory",
  // "ReferenceNumber", etc.) resolve automatically.
  const headers = input.rows.length > 0 ? Object.keys(input.rows[0]) : []
  const mapping = await mapColumnsWithGemini(
    headers,
    [
      {
        key: "vendorItemNo",
        label: "Vendor Item Number / Catalog Number / Reference",
        required: true,
      },
      {
        key: "productDescription",
        label: "Product Description / Item Name",
        required: false,
      },
      { key: "contractPrice", label: "Contract Price / Unit Price / Net Cost", required: false },
      { key: "listPrice", label: "List Price / MSRP", required: false },
      { key: "manufacturerNo", label: "Manufacturer Item Number", required: false },
      { key: "uom", label: "Unit of Measure / UOM", required: false },
      { key: "category", label: "Category / Product Category", required: false },
    ],
    input.rows
  )

  const today = new Date()
  for (const row of input.rows) {
    try {
      const vendorItemNo = get(row, mapping, "vendorItemNo")
      if (!vendorItemNo) {
        failed++
        continue
      }

      const contractPrice = parseMoney(get(row, mapping, "contractPrice"))
      const listPrice = parseMoney(get(row, mapping, "listPrice")) || contractPrice
      const productDescription = get(row, mapping, "productDescription") || vendorItemNo
      const manufacturerNo = get(row, mapping, "manufacturerNo") || undefined
      const uom = get(row, mapping, "uom") || undefined
      const category = get(row, mapping, "category") || undefined

      await prisma.pricingFile.create({
        data: {
          vendorId,
          facilityId,
          vendorItemNo,
          manufacturerNo,
          productDescription,
          listPrice: listPrice || 0,
          contractPrice: contractPrice || 0,
          effectiveDate: today,
          category,
          uom,
        },
      })
      imported++
    } catch {
      failed++
    }
  }

  const vendor = await prisma.vendor.findUnique({
    where: { id: vendorId },
    select: { name: true },
  })

  await logAudit({
    userId,
    action: "pricing.imported_via_mass_upload",
    entityType: "pricingFile",
    metadata: {
      imported,
      failed,
      vendorId,
      vendorName: vendor?.name,
      fileName: input.fileName ?? null,
      rowCount: input.rows.length,
    },
  })

  revalidatePath("/dashboard/cog-data")
  return { imported, failed, vendorUsed: vendor?.name ?? null }
}

