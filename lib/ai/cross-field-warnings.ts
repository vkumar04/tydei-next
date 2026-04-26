/**
 * Cross-field consistency checks for AI-extracted contracts.
 *
 * These are NOT hard validation errors (Zod handles those at the
 * boundary). They're "things a human reviewer would notice" —
 * surfaced as soft warnings in the review dialog so the user knows
 * what to double-check before saving.
 *
 * Rules implemented:
 *   1. effectiveDate must be < expirationDate
 *   2. Tier `spendMin` must be strictly monotonic across `tierNumber`
 *   3. Tier `volumeMin` must be strictly monotonic across `tierNumber`
 *   4. Tier `marketShareMin` must be strictly monotonic across `tierNumber`
 *   5. `rebateValue` should be > 0 for every tier (else it's a no-rebate
 *      tier which is unusual)
 *   6. `totalValue` should be ≥ `annualValue` if both present
 *   7. At least one term should be present (contracts without terms
 *      can't earn rebates — flag if zero)
 *   8. `productCategories` array shouldn't include the empty string
 *      or duplicates
 */

import type { ExtractedContractData } from "@/lib/ai/schemas"

export interface ContractWarning {
  /** Path into the data tree (e.g. ["terms", 0, "tiers"]). For UI to highlight. */
  path: string[]
  severity: "warning" | "info"
  message: string
}

export function findContractWarnings(
  data: ExtractedContractData,
): ContractWarning[] {
  const warnings: ContractWarning[] = []

  // 1. Date sanity
  if (data.effectiveDate && data.expirationDate) {
    if (new Date(data.effectiveDate) >= new Date(data.expirationDate)) {
      warnings.push({
        path: ["expirationDate"],
        severity: "warning",
        message: `Expiration date (${data.expirationDate}) is on or before effective date (${data.effectiveDate}).`,
      })
    }
  }

  // 6. Total vs annual
  // (extracted schema doesn't have annualValue, but if it did this is where
  // we'd check it). Currently a no-op placeholder.

  // 7. No terms at all
  if (!data.terms || data.terms.length === 0) {
    warnings.push({
      path: ["terms"],
      severity: "warning",
      message:
        "No rebate terms were extracted. The contract may have only locked pricing, or the extractor missed the terms section.",
    })
  }

  // 8. Product categories
  if (data.productCategories) {
    const empties = data.productCategories.filter((c) => !c || c.trim() === "")
    if (empties.length > 0) {
      warnings.push({
        path: ["productCategories"],
        severity: "info",
        message: `${empties.length} empty entr${empties.length === 1 ? "y" : "ies"} in product categories — clean up before saving.`,
      })
    }
    const lower = data.productCategories.map((c) => c?.toLowerCase().trim())
    const dupes = lower.filter((c, i) => c && lower.indexOf(c) !== i)
    if (dupes.length > 0) {
      warnings.push({
        path: ["productCategories"],
        severity: "info",
        message: `Duplicate product categories detected: ${[...new Set(dupes)].join(", ")}.`,
      })
    }
  }

  // 2-5. Tier checks per term
  for (const [termIdx, term] of (data.terms ?? []).entries()) {
    if (!term.tiers || term.tiers.length < 2) continue

    const sortedByTierNumber = [...term.tiers].sort(
      (a, b) => a.tierNumber - b.tierNumber,
    )

    // 2. spendMin monotonic
    const spendMins = sortedByTierNumber.map((t) => t.spendMin)
    if (spendMins.every((v) => v != null)) {
      for (let i = 1; i < spendMins.length; i++) {
        if (spendMins[i]! <= spendMins[i - 1]!) {
          warnings.push({
            path: ["terms", String(termIdx), "tiers"],
            severity: "warning",
            message: `Term "${term.termName}" tier ${i + 1} spendMin ($${spendMins[i]?.toLocaleString()}) is not greater than tier ${i} spendMin ($${spendMins[i - 1]?.toLocaleString()}). Tiers should escalate.`,
          })
          break
        }
      }
    }

    // 3. volumeMin monotonic (only flag if defined for ≥2 tiers)
    const volMins = sortedByTierNumber
      .map((t) => t.volumeMin)
      .filter((v) => v != null) as number[]
    if (volMins.length >= 2) {
      for (let i = 1; i < volMins.length; i++) {
        if (volMins[i] <= volMins[i - 1]) {
          warnings.push({
            path: ["terms", String(termIdx), "tiers"],
            severity: "warning",
            message: `Term "${term.termName}" volumeMin should escalate across tiers.`,
          })
          break
        }
      }
    }

    // 4. marketShareMin monotonic
    const msMins = sortedByTierNumber
      .map((t) => t.marketShareMin)
      .filter((v) => v != null) as number[]
    if (msMins.length >= 2) {
      for (let i = 1; i < msMins.length; i++) {
        if (msMins[i] <= msMins[i - 1]) {
          warnings.push({
            path: ["terms", String(termIdx), "tiers"],
            severity: "warning",
            message: `Term "${term.termName}" marketShareMin should escalate across tiers.`,
          })
          break
        }
      }
    }

    // 5. zero-rebate tiers
    const zeroRebateTiers = sortedByTierNumber.filter(
      (t) => t.rebateValue === 0 || t.rebateValue == null,
    )
    if (zeroRebateTiers.length > 0 && zeroRebateTiers.length < term.tiers.length) {
      // Mixed — some have rebate, some don't. Likely an extraction miss.
      warnings.push({
        path: ["terms", String(termIdx), "tiers"],
        severity: "info",
        message: `Term "${term.termName}" has ${zeroRebateTiers.length} tier(s) with zero / missing rebateValue while other tiers have rebates. Verify the extractor caught all rates.`,
      })
    }
  }

  return warnings
}
