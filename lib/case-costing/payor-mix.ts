/**
 * Payor-mix pure helper.
 *
 * Classifies a collection of cases by payor type and surfaces:
 *  - Share of cases per payor (fraction 0-1, summing to 1 over classified cases)
 *  - Reimbursement dollars per payor
 *  - Count of cases that have no payor on file (surfaced separately so they
 *    don't distort the share denominator)
 *
 * Design invariants:
 *  - Pure. No Prisma imports. Callers shape data into `CaseWithPayor[]`.
 *  - Every `PayorType` key is pre-initialized on both `shares` and
 *    `reimbursementByPayor` so callers can read `shares.commercial` etc.
 *    without guarding for missing keys.
 *  - Zero classified cases → every share is 0 (not NaN).
 *  - Null-payor cases are NOT counted in the share denominator.
 */

export type PayorType =
  | "commercial"
  | "medicare"
  | "medicaid"
  | "private"
  | "workers_comp"
  | "other"

export interface CaseWithPayor {
  payorType: PayorType | null
  totalReimbursement: number
}

export interface PayorMixSummary {
  /** Fraction 0-1 per payor type. */
  shares: Record<PayorType, number>
  reimbursementByPayor: Record<PayorType, number>
  totalCases: number
  totalReimbursement: number
  /** Cases without a payor — surfaced separately (not in shares). */
  casesWithoutPayor: number
}

const PAYOR_TYPES: readonly PayorType[] = [
  "commercial",
  "medicare",
  "medicaid",
  "private",
  "workers_comp",
  "other",
] as const

/**
 * Map a raw `Case.payorClass` value onto the canonical payor-mix buckets
 * (audit M8). Mirrors the COMMERCIAL_PAYORS grouping in
 * `lib/actions/cases.ts` `getSurgeonScorecards`: the named commercial
 * carriers (blue_cross / aetna / united) all count as "commercial".
 * Unknown non-empty classes fall into "other" so they still classify
 * (rather than distorting the casesWithoutPayor count); null/blank → null.
 *
 * 2026-06-14 ("I elected a payor and it still says no payor data"): real
 * case-upload files carry the payor as a free-text carrier name —
 * "Medicare Advantage", "Anthem BCBS", "UnitedHealthcare", "UHC",
 * "Cigna PPO", "Self-Pay" — not the tidy seed tokens. The old exact-token
 * match dropped every one of those to "other", so a facility whose cases
 * DID carry payor still read as undifferentiated. This now matches on
 * substrings/aliases (same canonical-comparison philosophy as
 * `normalizeSku` / `canonicalizeCategoryName`), so the surgeon + facility
 * payor-mix surfaces classify real carrier names. Order matters: medicaid
 * before medicare (so "medicare"-substring tests don't swallow it), and
 * the specific government/comp buckets before the broad commercial sweep.
 */
const COMMERCIAL_ALIASES = [
  "commercial",
  "blue_cross",
  "blue cross",
  "bcbs",
  "anthem",
  "wellpoint",
  "aetna",
  "united",
  "unitedhealth",
  "uhc",
  "cigna",
  "humana",
  "oscar",
  "ppo",
  "hmo",
  "epo",
  "pos",
]

export function classifyPayorClass(
  payorClass: string | null | undefined,
): PayorType | null {
  if (!payorClass) return null
  const cls = payorClass.trim().toLowerCase()
  if (!cls) return null

  // Specific buckets first — these tokens are unambiguous and must not be
  // swallowed by the broad commercial sweep below.
  if (cls.includes("medicaid")) return "medicaid"
  if (cls.includes("medicare")) return "medicare" // incl. "Medicare Advantage"
  if (
    cls.includes("workers_comp") ||
    cls.includes("workers comp") ||
    cls.includes("workers' comp") ||
    cls.includes("work comp") ||
    cls === "wc"
  ) {
    return "workers_comp"
  }
  if (
    cls.includes("self-pay") ||
    cls.includes("self pay") ||
    cls.includes("selfpay") ||
    cls.includes("private pay") ||
    cls === "private" ||
    cls === "cash" ||
    cls === "uninsured"
  ) {
    return "private"
  }

  if (COMMERCIAL_ALIASES.some((a) => cls.includes(a))) return "commercial"

  // Non-empty but unrecognized — classify as "other" so it still counts
  // toward the share denominator (vs. distorting casesWithoutPayor).
  return "other"
}

function emptyPayorRecord(): Record<PayorType, number> {
  return {
    commercial: 0,
    medicare: 0,
    medicaid: 0,
    private: 0,
    workers_comp: 0,
    other: 0,
  }
}

export function computePayorMix(cases: CaseWithPayor[]): PayorMixSummary {
  const shares = emptyPayorRecord()
  const reimbursementByPayor = emptyPayorRecord()
  const countByPayor = emptyPayorRecord()

  let totalClassifiedCases = 0
  let casesWithoutPayor = 0
  let totalReimbursement = 0

  for (const c of cases) {
    const reimbursement = Number.isFinite(c.totalReimbursement)
      ? c.totalReimbursement
      : 0
    totalReimbursement += reimbursement

    if (c.payorType === null) {
      casesWithoutPayor += 1
      continue
    }

    countByPayor[c.payorType] += 1
    reimbursementByPayor[c.payorType] += reimbursement
    totalClassifiedCases += 1
  }

  if (totalClassifiedCases > 0) {
    for (const p of PAYOR_TYPES) {
      shares[p] = countByPayor[p] / totalClassifiedCases
    }
  }

  return {
    shares,
    reimbursementByPayor,
    totalCases: cases.length,
    totalReimbursement,
    casesWithoutPayor,
  }
}
