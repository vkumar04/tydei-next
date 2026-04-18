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
