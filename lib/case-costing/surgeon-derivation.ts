/**
 * Case costing — surgeon derivation.
 *
 * Reference: docs/superpowers/specs/2026-04-18-case-costing-rewrite.md §4.0
 * (Subsystem 0 — surgeon derivation engine).
 *
 * Pure function — groups raw case rows by surgeon name and produces aggregated
 * surgeon scorecards. Specialty inference + scoring are delegated to the
 * shared helpers (`inferDominantSpecialty`, `calculateSurgeonScores`).
 */

import { inferDominantSpecialty, type Specialty } from "./specialty-infer"
import { calculateSurgeonScores, type ScoreColor } from "./score-calc"

/** A single case row in the shape consumed by {@link deriveSurgeons}. */
export interface CaseForDerivation {
  surgeonName: string
  primaryCptCode: string | null
  totalSpend: number
  totalReimbursement: number
  /** "commercial" | "medicare" | "medicaid" | "private" | null */
  payorType: string | null
}

/** Aggregated surgeon scorecard. */
export interface Surgeon {
  name: string
  specialty: Specialty
  caseCount: number
  totalSpend: number
  totalReimbursement: number
  avgSpendPerCase: number
  avgReimbursementPerCase: number
  avgMarginPct: number
  commercialOrPrivatePayors: number
  totalPayors: number
  payorMixScore: number
  spendScore: number
  overallScore: number
  color: ScoreColor
  cptCodes: string[]
}

const COMMERCIAL_OR_PRIVATE = new Set(["commercial", "private"])

/**
 * Aggregate raw case rows into per-surgeon scorecards.
 *
 * Algorithm (canonical §4.0):
 *   - skip cases with null/empty surgeonName
 *   - group remaining cases by surgeonName
 *   - for each surgeon:
 *       caseCount            = cases.length
 *       cptCodes             = unique non-null primaryCptCode list
 *       specialty            = inferDominantSpecialty(cptCodes)
 *       totalSpend           = Σ case.totalSpend
 *       totalReimbursement   = Σ case.totalReimbursement
 *       avgSpendPerCase      = totalSpend / caseCount
 *       avgReimbursementPerCase = totalReimbursement / caseCount
 *       avgMarginPct         = totalReimbursement > 0
 *                              ? ((totalReimbursement - totalSpend) / totalReimbursement) * 100
 *                              : 0
 *       totalPayors          = |{payorType : non-null}|  (distinct)
 *       commercialOrPrivatePayors
 *                            = |{payorType : commercial|private}|  (distinct)
 *       scores               = calculateSurgeonScores(...)
 *
 *   - returned sorted by overallScore DESC, tie-break by totalSpend DESC.
 */
export function deriveSurgeons(input: {
  cases: CaseForDerivation[]
}): Surgeon[] {
  const groups = new Map<string, CaseForDerivation[]>()
  for (const c of input.cases) {
    if (!c.surgeonName) continue
    const existing = groups.get(c.surgeonName)
    if (existing) existing.push(c)
    else groups.set(c.surgeonName, [c])
  }

  const surgeons: Surgeon[] = []
  for (const [name, cases] of groups) {
    const caseCount = cases.length

    // Distinct CPT codes (non-null), preserve first-seen order.
    const cptSet = new Set<string>()
    const cptCodes: string[] = []
    for (const c of cases) {
      if (c.primaryCptCode && !cptSet.has(c.primaryCptCode)) {
        cptSet.add(c.primaryCptCode)
        cptCodes.push(c.primaryCptCode)
      }
    }

    const specialty = inferDominantSpecialty(cptCodes)

    let totalSpend = 0
    let totalReimbursement = 0
    for (const c of cases) {
      totalSpend += c.totalSpend
      totalReimbursement += c.totalReimbursement
    }

    const avgSpendPerCase = caseCount > 0 ? totalSpend / caseCount : 0
    const avgReimbursementPerCase =
      caseCount > 0 ? totalReimbursement / caseCount : 0
    const avgMarginPct =
      totalReimbursement > 0
        ? ((totalReimbursement - totalSpend) / totalReimbursement) * 100
        : 0

    // Distinct payor-type tallies.
    const payorTypes = new Set<string>()
    const commercialOrPrivate = new Set<string>()
    for (const c of cases) {
      if (!c.payorType) continue
      payorTypes.add(c.payorType)
      if (COMMERCIAL_OR_PRIVATE.has(c.payorType)) {
        commercialOrPrivate.add(c.payorType)
      }
    }
    const totalPayors = payorTypes.size
    const commercialOrPrivatePayors = commercialOrPrivate.size

    const scores = calculateSurgeonScores({
      commercialOrPrivatePayors,
      totalPayors,
      avgSpendPerCase,
    })

    surgeons.push({
      name,
      specialty,
      caseCount,
      totalSpend,
      totalReimbursement,
      avgSpendPerCase,
      avgReimbursementPerCase,
      avgMarginPct,
      commercialOrPrivatePayors,
      totalPayors,
      payorMixScore: scores.payorMixScore,
      spendScore: scores.spendScore,
      overallScore: scores.overallScore,
      color: scores.color,
      cptCodes,
    })
  }

  surgeons.sort((a, b) => {
    if (b.overallScore !== a.overallScore) {
      return b.overallScore - a.overallScore
    }
    return b.totalSpend - a.totalSpend
  })

  return surgeons
}
