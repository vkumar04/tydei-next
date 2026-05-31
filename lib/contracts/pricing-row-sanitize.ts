/**
 * Defensive coercion for ContractPricing rows before they hit Prisma's
 * `createMany`.
 *
 * Vick 2026-05-31 ("I think the carve out file is a problem"): the
 * contract-linked pricing import (`importContractPricing`) wrote raw
 * values straight into the row. Three of those can make Prisma reject
 * the row and — because the insert runs inside a single transaction —
 * roll back the ENTIRE batch, surfacing only a redacted "An error
 * occurred in the Server Components render" toast:
 *
 *   1. `carveOutPercent` lands in a Decimal(5,4) column (max 9.9999).
 *      A carve-out file that supplies percent-points (30 → meant 0.30)
 *      overflows the column. Mirror `ingestPricingFile`'s normalization
 *      (>1 ⇒ /100) and drop anything still out of range.
 *   2. `unitPrice`/`listPrice` can arrive as `NaN` (e.g. a "-" cell →
 *      `parseFloat("-")`). Prisma rejects NaN for a Decimal field.
 *   3. `effectiveDate`/`expirationDate` from the AI-extract path can be
 *      unparseable strings → `new Date(x)` = Invalid Date → Prisma throws.
 *
 * Sanitizing per-row means one bad row degrades to safe defaults
 * instead of nuking the whole import.
 */
import type { ContractPricingItem } from "@/lib/actions/pricing-files-types"

export interface SanitizedPricingRow {
  vendorItemNo: string
  description?: string
  category?: string
  unitPrice: number
  listPrice: number | null
  uom: string
  carveOutPercent: number | null
  effectiveDate: Date | null
  expirationDate: Date | null
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v)
}

function toValidDate(v: string | undefined): Date | null {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * Normalize a per-SKU carve-out rate into the Decimal(5,4) fraction the
 * column expects. Values > 1 are assumed percent-points (30 → 0.30),
 * matching `ingestPricingFile`. Anything non-finite or still outside
 * [0, 9.9999] after normalization is dropped to null rather than
 * overflowing the column.
 */
export function normalizeCarveOutPercent(value: number | undefined | null): number | null {
  if (!isFiniteNumber(value)) return null
  const fraction = value > 1 ? value / 100 : value
  if (fraction < 0 || fraction > 9.9999) return null
  return fraction
}

export function sanitizePricingRow(item: ContractPricingItem): SanitizedPricingRow {
  return {
    vendorItemNo: item.vendorItemNo,
    description: item.description,
    category: item.category,
    // Decimal(12,2), required — fall back to 0 on garbage so the row
    // still imports rather than rolling back the batch.
    unitPrice: isFiniteNumber(item.unitPrice) ? item.unitPrice : 0,
    // Decimal(12,2), nullable — undefined/NaN ⇒ null (no list price).
    listPrice: isFiniteNumber(item.listPrice) ? item.listPrice : null,
    uom: item.uom ?? "EA",
    carveOutPercent: normalizeCarveOutPercent(item.carveOutPercent),
    effectiveDate: toValidDate(item.effectiveDate),
    expirationDate: toValidDate(item.expirationDate),
  }
}
