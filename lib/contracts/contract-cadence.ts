/**
 * Canonical contract-cadence derivation — 2026-06-09 (Charles
 * "Performance period, rebate period — should match").
 *
 * `Contract.performancePeriod` / `Contract.rebatePayPeriod` are set once at
 * create from DEFAULTS (monthly / quarterly) and never reconciled with the
 * fields that actually drive the engine — `ContractTerm.evaluationPeriod`
 * (tier evaluation cadence) and `ContractTerm.paymentTiming` (payout
 * cadence). On prod, the Mako tie-in displayed "monthly / quarterly" while
 * its only term evaluates and pays SEMI-ANNUALLY.
 *
 * This helper is the single place display surfaces derive the two values:
 * when the contract has terms, the modal (most common) term cadence wins —
 * displays can never contradict the engine; the stored columns are the
 * fallback for term-less contracts. Used by the facility Contract Details
 * panel, the vendor contract overview, the PDF export, and the AI prompt
 * context. Stored columns are NOT rewritten (they back vendor change
 * proposals + amendment flagging).
 */

export interface CadenceTermLike {
  evaluationPeriod?: string | null
  paymentTiming?: string | null
}

export interface DerivedContractCadence {
  performancePeriod: string
  rebatePayPeriod: string
}

/** Most-common non-empty value; ties break toward the EARLIEST term (terms
 * are conventionally ordered createdAt asc by every caller's query). */
function modal(values: Array<string | null | undefined>): string | null {
  const counts = new Map<string, number>()
  const order: string[] = []
  for (const v of values) {
    if (!v) continue
    if (!counts.has(v)) order.push(v)
    counts.set(v, (counts.get(v) ?? 0) + 1)
  }
  let best: string | null = null
  let bestCount = 0
  for (const v of order) {
    const c = counts.get(v) ?? 0
    if (c > bestCount) {
      best = v
      bestCount = c
    }
  }
  return best
}

export function deriveContractCadence(
  terms: readonly CadenceTermLike[] | null | undefined,
  stored: {
    performancePeriod?: string | null
    rebatePayPeriod?: string | null
  },
): DerivedContractCadence {
  const termList = terms ?? []
  const evalModal = modal(termList.map((t) => t.evaluationPeriod))
  const payModal = modal(termList.map((t) => t.paymentTiming))
  return {
    performancePeriod:
      evalModal ?? stored.performancePeriod ?? "monthly",
    rebatePayPeriod:
      payModal ?? stored.rebatePayPeriod ?? "quarterly",
  }
}
