/**
 * Merge per-chunk ExtractedContractData payloads from
 * pdf-chunker'd extractions into a single contract result.
 *
 * Field-by-field policy:
 *
 * Top-level identity (contractName, vendorName, contractType,
 * effectiveDate, expirationDate, totalValue, etc.):
 *   First non-null / non-empty wins. The first chunk almost always
 *   carries cover-page metadata, so chunk-1 takes precedence on
 *   conflicts. Subsequent chunks fill blanks but don't overwrite.
 *
 * productCategories / fieldConfidences:
 *   Union of all chunks. Categories deduped by case-folded label;
 *   confidences take the MAX across chunks (the chunk that "saw"
 *   the field had higher confidence than a chunk that didn't).
 *
 * terms[]:
 *   Concatenated across chunks. Some PDFs reprint terms on a
 *   summary page that lands in a later chunk; we dedupe by
 *   (termName + termType) so the same term doesn't double-count.
 *   Tier arrays inside a term aren't merged — if two chunks both
 *   report the same termName with different tiers, the chunk
 *   with MORE tiers wins (assumption: longer tier list = more
 *   complete extract of that term).
 *
 * Capital fields (capitalCost, interestRatePercent, etc.):
 *   First non-null wins, same as top-level identity.
 */

import { z } from "zod"
import { extractedContractSchema, type ExtractedContractData } from "./schemas"

type Term = ExtractedContractData["terms"][number]

/**
 * Per-chunk extraction schema: same shape as the full
 * extractedContractSchema, but with the header identity fields
 * (contractName, vendorName, contractType) relaxed to allow
 * null/undefined. Mid-document chunks (e.g. pricing-table-only
 * pages) have no header to report; forcing them through the
 * strict schema produces `AI_NoObjectGeneratedError`. Header
 * fields come from chunk-1 anyway via mergeExtractedContracts.
 */
export const chunkExtractSchema = extractedContractSchema.extend({
  contractName: z.string().nullable().optional(),
  vendorName: z.string().nullable().optional(),
  contractType: extractedContractSchema.shape.contractType
    .nullable()
    .optional(),
})

export type ChunkExtractData = z.infer<typeof chunkExtractSchema>

const firstNonEmptyString = (
  values: Array<string | null | undefined>,
): string | undefined => {
  for (const v of values) {
    if (typeof v === "string" && v.trim().length > 0) return v
  }
  return undefined
}

const firstDefined = <T>(values: Array<T | null | undefined>): T | undefined => {
  for (const v of values) {
    if (v !== null && v !== undefined) return v
  }
  return undefined
}

const termKey = (t: Term): string =>
  `${(t.termName ?? "").trim().toLowerCase()}|${(t.termType ?? "").trim().toLowerCase()}`

export function mergeExtractedContracts(
  parts: Array<ExtractedContractData | ChunkExtractData>,
): ExtractedContractData {
  if (parts.length === 0) {
    throw new Error("mergeExtractedContracts: no parts to merge")
  }
  if (parts.length === 1) {
    const only = parts[0]!
    return {
      ...only,
      contractName: only.contractName ?? "",
      vendorName: only.vendorName ?? "",
      contractType: only.contractType ?? "usage",
    } as ExtractedContractData
  }

  const head = parts[0]!

  // identity fields — first non-empty/non-null across chunks. Chunks
  // are permitted to omit these (mid-document chunks have no header
  // to report) so we backstop with sensible defaults if EVERY chunk
  // came back blank — the dialog still renders without a crash.
  const contractName =
    firstNonEmptyString(parts.map((p) => p.contractName)) ??
    head.contractName ??
    ""
  const vendorName =
    firstNonEmptyString(parts.map((p) => p.vendorName)) ??
    head.vendorName ??
    ""
  const contractType =
    firstDefined(parts.map((p) => p.contractType)) ?? head.contractType ?? "usage"

  const contractNumber = firstNonEmptyString(parts.map((p) => p.contractNumber))
  const effectiveDate = firstNonEmptyString(parts.map((p) => p.effectiveDate))
  const expirationDate = firstNonEmptyString(parts.map((p) => p.expirationDate))
  const description = firstNonEmptyString(parts.map((p) => p.description))
  const productCategory = firstNonEmptyString(parts.map((p) => p.productCategory))

  const totalValue = firstDefined(parts.map((p) => p.totalValue))
  const capitalCost = firstDefined(parts.map((p) => p.capitalCost))
  const interestRatePercent = firstDefined(
    parts.map((p) => p.interestRatePercent),
  )
  const termMonths = firstDefined(parts.map((p) => p.termMonths))
  const paymentCadence = firstDefined(parts.map((p) => p.paymentCadence))
  const downPayment = firstDefined(parts.map((p) => p.downPayment))

  // productCategories — union, case-fold dedupe, preserve first-seen casing
  const catSeen = new Set<string>()
  const productCategories: string[] = []
  for (const part of parts) {
    for (const cat of part.productCategories ?? []) {
      const key = cat.trim().toLowerCase()
      if (!key || catSeen.has(key)) continue
      catSeen.add(key)
      productCategories.push(cat)
    }
  }

  // fieldConfidences — max-across-chunks per field
  const confidences: Record<string, number> = {}
  for (const part of parts) {
    for (const [field, score] of Object.entries(part.fieldConfidences ?? {})) {
      if (typeof score !== "number") continue
      const prev = confidences[field]
      if (prev === undefined || score > prev) confidences[field] = score
    }
  }

  // terms — dedupe by (termName + termType); winner = chunk with more tiers
  const termsByKey = new Map<string, Term>()
  for (const part of parts) {
    for (const term of part.terms ?? []) {
      const key = termKey(term)
      const prev = termsByKey.get(key)
      if (!prev) {
        termsByKey.set(key, term)
        continue
      }
      if ((term.tiers?.length ?? 0) > (prev.tiers?.length ?? 0)) {
        termsByKey.set(key, term)
      }
    }
  }

  return {
    contractName,
    contractNumber,
    vendorName,
    contractType,
    effectiveDate: effectiveDate ?? null,
    expirationDate: expirationDate ?? null,
    totalValue,
    capitalCost,
    interestRatePercent,
    termMonths,
    paymentCadence,
    downPayment,
    description,
    productCategory,
    productCategories: productCategories.length > 0 ? productCategories : undefined,
    fieldConfidences: Object.keys(confidences).length > 0 ? confidences : undefined,
    terms: Array.from(termsByKey.values()),
  }
}
