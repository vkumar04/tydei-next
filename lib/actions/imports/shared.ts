/**
 * Shared helpers for the mass-upload pipeline.
 *
 * Plain server-side module (no "use server" directive) — only imported
 * by the actual server action files under lib/actions/imports/*.
 *
 * Contents:
 *   - TargetField (type)
 *   - mapColumnsWithAI (renamed from mapColumnsWithGemini; Claude-backed)
 *   - localFallbackMap (deterministic fallback)
 *   - parseCSV / parseMoney / parseDate / toSafeDate
 *   - findOrCreateVendorByName (thin wrapper over lib/vendors/resolve)
 *   - get (row-by-mapping field getter)
 *   - toContractType / toPerfPeriod / toTermType / toRebateType (AI→enum)
 */
import { generateText, Output } from "ai"
import { z } from "zod"
import { prisma } from "@/lib/db"
import { resolveVendorId } from "@/lib/vendors/resolve"
import { claudeModel } from "@/lib/ai/config"
import { columnMappingPrompt } from "@/lib/ai/prompts"
import type { RichContractExtractData } from "@/lib/ai/schemas"
import type {
  ContractType,
  PerformancePeriod,
  RebateType,
  TermType,
} from "@prisma/client"

export type TargetField = { key: string; label: string; required: boolean }

/**
 * AI-backed column mapper. Instead of hardcoding every possible header
 * alias ("ReferenceNumber", "Product Catgory" [sic], etc.), we ask
 * Claude to semantically map the caller's source CSV/Excel headers to
 * a target schema. Falls back to a best-effort fuzzy match when the
 * model is unavailable (rate limited, transient error, no API key).
 *
 * Previously named mapColumnsWithGemini — renamed during the F16 tech
 * debt split because the underlying model is now Claude (Opus 4.6).
 */
export async function mapColumnsWithAI(
  sourceHeaders: string[],
  targetFields: TargetField[],
  sampleRows: Record<string, string>[],
): Promise<Record<string, string>> {
  try {
    const mappingShape: Record<string, z.ZodTypeAny> = {}
    for (const field of targetFields) {
      mappingShape[field.key] = z
        .string()
        .describe(
          `The source column header that best maps to "${field.label}". Return "" if no source column matches.`,
        )
    }
    const schema = z.object(mappingShape)

    // Prompt text is built by the centralized `columnMappingPrompt` in
    // `lib/ai/prompts/index.ts` so there's one source of truth shared
    // across every column-mapping surface (this action, COG rewrite,
    // data pipeline). The builder returns a stable `system` prefix
    // (cacheable) and a volatile `user` suffix (the actual headers +
    // sample rows).
    const { system, user } = columnMappingPrompt(
      sourceHeaders,
      targetFields,
      sampleRows,
    )

    const result = await generateText({
      model: claudeModel,
      output: Output.object({ schema }),
      system,
      prompt: user,
    })

    const mapping = result.output as Record<string, string>
    const clean: Record<string, string> = {}
    for (const [k, v] of Object.entries(mapping)) {
      if (v && sourceHeaders.includes(v)) clean[k] = v
    }
    return clean
  } catch (err) {
    console.warn("[mapColumnsWithAI] falling back to local match:", err)
    return localFallbackMap(sourceHeaders, targetFields)
  }
}

const NORM = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "")

export function localFallbackMap(
  headers: string[],
  targetFields: TargetField[],
): Record<string, string> {
  const mapping: Record<string, string> = {}
  for (const field of targetFields) {
    const k = NORM(field.key)
    const l = NORM(field.label)
    const match = headers.find((h) => {
      const n = NORM(h)
      // Charles W2.C-C: the match must be symmetric. When a header is
      // SHORT ("Vendor", "Date Ordered") and the target label is a
      // LONG superset ("Vendor / Supplier Name", "Catalog / Product
      // Reference / Vendor Item Number"), the header doesn't contain
      // the label — but the label does contain the header. Check both
      // directions so real-world CSVs don't silently drop columns.
      return (
        n === k ||
        n === l ||
        n.includes(k) ||
        n.includes(l) ||
        k.includes(n) ||
        l.includes(n)
      )
    })
    if (match) mapping[field.key] = match
  }
  return mapping
}

/** Get a field value from a row using the resolved column mapping. */
export function get(
  row: Record<string, string>,
  mapping: Record<string, string>,
  key: string,
): string {
  const col = mapping[key]
  if (!col) return ""
  return (row[col] ?? "").trim()
}

/**
 * Parse a CSV string into an array of row objects keyed by header.
 * Handles BOMs, CRLF line endings, and quoted fields containing commas.
 * No deps.
 */
export function parseCSV(text: string): Record<string, string>[] {
  const stripped = text.replace(/^\uFEFF/, "")
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
export function parseMoney(raw: string | undefined): number {
  if (!raw) return 0
  const cleaned = raw.replace(/[$,\s]/g, "").replace(/[()]/g, "")
  if (!cleaned || cleaned === "-") return 0
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : 0
}

/** Parse MM/DD/YYYY or YYYY-MM-DD or MM/DD/YYYY HH:MM → Date. */
export function parseDate(raw: string | undefined): Date | null {
  if (!raw) return null
  const cleaned = raw.trim().split(" ")[0]
  if (!cleaned || cleaned === "-") return null
  const usMatch = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (usMatch) {
    const [, m, d, y] = usMatch
    return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)))
  }
  const isoMatch = cleaned.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (isoMatch) {
    const [, y, m, d] = isoMatch
    return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)))
  }
  const direct = new Date(cleaned)
  return Number.isNaN(direct.getTime()) ? null : direct
}

export function toSafeDate(
  input: string | null | undefined,
  fallback: Date,
): Date {
  if (!input) return fallback
  const d = new Date(input)
  return Number.isNaN(d.getTime()) ? fallback : d
}

/**
 * Resolve an incoming vendor name to a Vendor row id. Thin wrapper over
 * the shared resolver (exact → alias → fuzzy → create) that additionally
 * patches a `division` field on the row when provided.
 */
export async function findOrCreateVendorByName(
  name: string | null | undefined,
  division?: string | null,
): Promise<string> {
  const id = await resolveVendorId(name)
  if (id && division?.trim()) {
    await prisma.vendor
      .update({
        where: { id },
        data: { division: division.trim() },
      })
      .catch(() => {})
  }
  return id!
}

// ─── AI → Prisma enum coercers ──────────────────────────────────

export function toContractType(
  v: RichContractExtractData["contractType"],
): ContractType {
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

export function toPerfPeriod(
  v: string | null | undefined,
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

export function toTermType(v: string | null | undefined): TermType {
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

export function toRebateType(v: string | null | undefined): RebateType {
  if (!v) return "percent_of_spend"
  const allowed: RebateType[] = [
    "percent_of_spend",
    "fixed_rebate",
    "fixed_rebate_per_unit",
    "per_procedure_rebate",
  ]
  return allowed.includes(v as RebateType)
    ? (v as RebateType)
    : "percent_of_spend"
}
