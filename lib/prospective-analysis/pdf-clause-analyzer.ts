/**
 * Prospective analysis — PDF contract clause analyzer
 * (spec §subsystem-7, docs/superpowers/specs/2026-04-18-prospective-analysis-rewrite.md).
 *
 * DETERMINISTIC FIRST PASS: runs the CLAUSE_LIBRARY regex patterns against
 * PDF text and produces a structured ClauseAnalysis:
 *   - per-category ClauseFinding (found + quote ±100 chars + risk/favorability)
 *   - missingHighRiskCategories — required clauses that weren't matched
 *   - overallRiskScore (0-10) — weighted aggregate of vendor-favorable
 *     findings and missing required clauses
 *   - human-readable summary headline
 *
 * PURE FUNCTION: no IO, no Claude calls. The optional Claude fallback
 * (spec §Integration with AI) is wired in a separate module.
 */

import {
  CLAUSE_LIBRARY,
  type ClauseCategory,
  type ClauseDetectionRule,
} from "./clause-library"

export interface ClauseFinding {
  category: ClauseCategory
  found: boolean
  /** The matched text segment with ±100 chars of surrounding context; null when not found. */
  quote: string | null
  riskLevel: "low" | "medium" | "high"
  favorability: "facility" | "neutral" | "vendor"
  recommendedAction: string | null
}

export interface ClauseAnalysis {
  findings: ClauseFinding[]
  missingHighRiskCategories: ClauseCategory[]
  /** 0-10; sum of per-finding risk weights / max possible × 10 */
  overallRiskScore: number
  summary: string
}

/** Context window (chars) of surrounding text captured with each match. */
const QUOTE_CONTEXT_CHARS = 100

/** Risk-weight map for aggregation into overallRiskScore. */
const RISK_WEIGHT: Record<"low" | "medium" | "high", number> = {
  low: 1,
  medium: 3,
  high: 5,
} as const

/** Weight assigned to each missing required-for-risk-analysis clause. */
const MISSING_REQUIRED_WEIGHT = 5

/**
 * Run each pattern in the rule; return the first RegExpMatchArray or null.
 * We use a single-shot match (no /g) — first hit wins.
 */
function firstPatternMatch(
  pdfText: string,
  rule: ClauseDetectionRule,
): RegExpMatchArray | null {
  for (const pattern of rule.patterns) {
    // Patterns are already flagged case-insensitive as authored.
    const match = pdfText.match(pattern)
    if (match && match.index != null) {
      return match
    }
  }
  return null
}

/**
 * Build a `quote` snippet: matched text + ±QUOTE_CONTEXT_CHARS of context,
 * clamped to string bounds. Whitespace-normalized for readability.
 */
function buildQuote(pdfText: string, match: RegExpMatchArray): string {
  const start = match.index ?? 0
  const end = start + match[0].length
  const windowStart = Math.max(0, start - QUOTE_CONTEXT_CHARS)
  const windowEnd = Math.min(pdfText.length, end + QUOTE_CONTEXT_CHARS)
  return pdfText.slice(windowStart, windowEnd).replace(/\s+/g, " ").trim()
}

/**
 * Compute overall risk score on a 0-10 scale.
 *
 * Numerator:
 *   + RISK_WEIGHT[riskLevel] for each FOUND finding with favorability = "vendor"
 *   + MISSING_REQUIRED_WEIGHT for each missing required clause
 *
 * Denominator (maxPossible):
 *   RISK_WEIGHT.high × (total rules) — i.e., the worst case where every
 *   clause scored as vendor-favorable at 'high' risk.
 */
function computeOverallRiskScore(
  findings: ClauseFinding[],
  missingHighRiskCategories: ClauseCategory[],
): number {
  let riskSum = 0
  for (const finding of findings) {
    if (finding.found && finding.favorability === "vendor") {
      riskSum += RISK_WEIGHT[finding.riskLevel]
    }
  }
  riskSum += missingHighRiskCategories.length * MISSING_REQUIRED_WEIGHT

  const maxPossible = CLAUSE_LIBRARY.length * RISK_WEIGHT.high
  if (maxPossible === 0) return 0

  const raw = (riskSum / maxPossible) * 10
  // Clamp defensively to [0, 10] — missing weight could in theory push > 10
  // if maxPossible calculation ever changes.
  if (raw < 0) return 0
  if (raw > 10) return 10
  // Round to 2 decimals for stable test snapshots.
  return Math.round(raw * 100) / 100
}

function buildSummary(
  findings: ClauseFinding[],
  missingHighRiskCategories: ClauseCategory[],
): string {
  const foundCount = findings.filter((f) => f.found).length
  const total = findings.length
  const highRiskFound = findings.filter(
    (f) => f.found && f.riskLevel === "high",
  ).length
  const missingCount = missingHighRiskCategories.length
  return `Found ${foundCount} of ${total} key clauses. ${highRiskFound} high-risk items. ${missingCount} missing required clauses.`
}

/**
 * Analyze raw PDF text against the clause library.
 *
 * @param pdfText — plain-text extraction of a contract PDF
 * @returns ClauseAnalysis with per-category findings + aggregate score
 */
export function analyzePDFContract(pdfText: string): ClauseAnalysis {
  const findings: ClauseFinding[] = []
  const missingHighRiskCategories: ClauseCategory[] = []

  for (const rule of CLAUSE_LIBRARY) {
    const match = firstPatternMatch(pdfText, rule)
    if (match) {
      findings.push({
        category: rule.category,
        found: true,
        quote: buildQuote(pdfText, match),
        riskLevel: rule.defaultRiskLevel,
        favorability: rule.defaultFavorability,
        recommendedAction: rule.recommendedAction,
      })
    } else {
      findings.push({
        category: rule.category,
        found: false,
        quote: null,
        // When the clause is MISSING, we still emit the rule's default
        // annotations as the downstream UI needs a stable shape — but
        // the `found: false` bit tells consumers to treat them as
        // "not observed" rather than concrete risk.
        riskLevel: rule.defaultRiskLevel,
        favorability: rule.defaultFavorability,
        recommendedAction: null,
      })
      if (rule.requiredForRiskAnalysis) {
        missingHighRiskCategories.push(rule.category)
      }
    }
  }

  const overallRiskScore = computeOverallRiskScore(
    findings,
    missingHighRiskCategories,
  )
  const summary = buildSummary(findings, missingHighRiskCategories)

  return {
    findings,
    missingHighRiskCategories,
    overallRiskScore,
    summary,
  }
}
