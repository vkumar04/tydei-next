/**
 * Normalize a list of vendor item numbers before persisting to
 * `ContractTermProduct`. (Charles 2026-04-25 audit follow-up.)
 *
 * The unique constraint `(termId, vendorItemNo)` means duplicate input
 * rows would either trip the index (without `skipDuplicates`) or be
 * silently dropped (with it). Either way we also want to strip
 * whitespace and drop empty strings so a vendor paste of
 * "ABC123, , ABC123 " collapses to a single `ABC123` row.
 *
 * Centralized here so every write site (contracts.ts create,
 * contract-terms.ts create+update, future approve paths) stays in
 * lockstep — drift between sites was the original concern.
 */
export function normalizeScopedItemNumbers(
  raw: ReadonlyArray<string> | null | undefined,
): string[] {
  if (!raw) return []
  return Array.from(
    new Set(
      raw
        .map((s) => (typeof s === "string" ? s.trim() : ""))
        .filter((s) => s.length > 0),
    ),
  )
}
