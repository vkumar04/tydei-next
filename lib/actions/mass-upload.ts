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
