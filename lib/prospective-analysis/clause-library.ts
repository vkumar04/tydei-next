/**
 * Prospective analysis — PDF contract clause detection library
 * (spec §subsystem-7, docs/superpowers/specs/2026-04-18-prospective-analysis-rewrite.md).
 *
 * Ports Charles's 25+ clause-category pattern library. Each entry maps a
 * ClauseCategory to a conservative set of regex patterns (2-5 per rule),
 * plus default risk / favorability annotations and a recommended action
 * for when that clause appears with facility-unfriendly language.
 *
 * CONSERVATIVE PATTERNS: we bias toward low false positives. Each pattern
 * combines a keyword with context phrasing so, e.g., "termination" alone
 * isn't enough — we require "termination for convenience" or similar.
 *
 * The 6 `requiredForRiskAnalysis: true` categories (per spec):
 *   termination_for_convenience, audit_rights, indemnification,
 *   limitation_of_liability, force_majeure, governing_law
 * — their ABSENCE is a high-risk signal (missing protective terms).
 */

export type ClauseCategory =
  | "auto_renewal"
  | "termination_for_convenience"
  | "termination_for_cause"
  | "price_protection"
  | "minimum_commitment"
  | "exclusivity"
  | "payment_terms"
  | "rebate_structure"
  | "audit_rights"
  | "indemnification"
  | "governing_law"
  | "dispute_resolution"
  | "assignment"
  | "force_majeure"
  | "confidentiality"
  | "warranty"
  | "limitation_of_liability"
  | "ip_ownership"
  | "most_favored_nation"
  | "volume_commitment"
  | "co_op_marketing"
  | "data_rights"
  | "insurance"
  | "compliance_reps"
  | "non_solicitation"
  | "gpo_affiliation"

export interface ClauseDetectionRule {
  category: ClauseCategory
  /** Regex patterns to match clause text. Matches ANY pattern = found. */
  patterns: RegExp[]
  /** Default risk level when the clause is detected with facility-unfriendly language. */
  defaultRiskLevel: "low" | "medium" | "high"
  /** Default favorability assessment. */
  defaultFavorability: "facility" | "neutral" | "vendor"
  /** Categories that SHOULD be present (absence is a risk) — for missing-clause detection. */
  requiredForRiskAnalysis: boolean
  /** Recommended action if this clause is found with unfriendly language. */
  recommendedAction: string
}

export const CLAUSE_LIBRARY: readonly ClauseDetectionRule[] = [
  {
    // Auto-renewal / evergreen clauses trap facilities into rollover terms
    // unless they remember to send timely non-renewal notice.
    category: "auto_renewal",
    patterns: [
      /automatic(ally)?\s+renew/i,
      /evergreen/i,
      /unless\s+(either\s+party\s+)?(provides?|gives?)\s+(written\s+)?notice/i,
      /successive\s+(one|two|three|\d+)[-\s]year\s+terms?/i,
    ],
    defaultRiskLevel: "high",
    defaultFavorability: "vendor",
    requiredForRiskAnalysis: false,
    recommendedAction:
      "Replace auto-renewal with affirmative opt-in; shorten notice window to 30 days.",
  },
  {
    // Termination for convenience — facility's exit hatch. Must be present.
    category: "termination_for_convenience",
    patterns: [
      /terminat(e|ion)\s+(for\s+)?convenience/i,
      /terminat(e|ion)\s+without\s+cause/i,
      /terminate\s+this\s+agreement\s+.{0,40}\s+(for\s+any\s+reason|at\s+any\s+time)/i,
    ],
    defaultRiskLevel: "low",
    defaultFavorability: "facility",
    requiredForRiskAnalysis: true,
    recommendedAction:
      "Ensure 30-60 day notice window and no early-termination penalty for the facility.",
  },
  {
    // Termination for cause — standard, but watch for asymmetric cure periods.
    category: "termination_for_cause",
    patterns: [
      /terminat(e|ion)\s+for\s+(cause|breach|default)/i,
      /material\s+breach/i,
      /cure\s+period/i,
    ],
    defaultRiskLevel: "medium",
    defaultFavorability: "neutral",
    requiredForRiskAnalysis: false,
    recommendedAction:
      "Verify cure period is symmetric (same for both parties) and ≥30 days.",
  },
  {
    // Price protection — caps vendor's ability to raise prices mid-term.
    category: "price_protection",
    patterns: [
      /price\s+protection/i,
      /price\s+(shall\s+not|will\s+not)\s+increase/i,
      /(fixed|firm)\s+pric(e|ing)/i,
      /cap(ped)?\s+(at\s+)?(\d+%|CPI)/i,
    ],
    defaultRiskLevel: "low",
    defaultFavorability: "facility",
    requiredForRiskAnalysis: false,
    recommendedAction:
      "Confirm price cap applies to ALL line-items, not just top tier.",
  },
  {
    // Minimum commitment — facility must buy X or pay penalty.
    category: "minimum_commitment",
    patterns: [
      /minimum\s+(purchase|volume|commitment|spend)/i,
      /commit(ment)?\s+to\s+purchase/i,
      /shortfall\s+(fee|penalty|payment)/i,
    ],
    defaultRiskLevel: "high",
    defaultFavorability: "vendor",
    requiredForRiskAnalysis: false,
    recommendedAction:
      "Tie minimum to historical baseline with a 15-20% safety margin; no shortfall penalty.",
  },
  {
    // Exclusivity — facility blocked from alternative suppliers.
    category: "exclusivity",
    patterns: [
      /exclusive(ly)?\s+(provider|supplier|vendor|source)/i,
      /shall\s+not\s+(purchase|procure)\s+from/i,
      /sole\s+(provider|supplier|source)/i,
    ],
    defaultRiskLevel: "high",
    defaultFavorability: "vendor",
    requiredForRiskAnalysis: false,
    recommendedAction:
      "Reject exclusivity or limit to named SKUs with a market-shift escape clause.",
  },
  {
    // Payment terms — Net 60/90 is facility-friendly; Net 15/30 is vendor-friendly.
    category: "payment_terms",
    patterns: [
      /net\s+\d{1,3}\s+days?/i,
      /payment\s+terms?/i,
      /due\s+within\s+\d+\s+days?/i,
    ],
    defaultRiskLevel: "low",
    defaultFavorability: "neutral",
    requiredForRiskAnalysis: false,
    recommendedAction:
      "Negotiate to Net 60 or Net 90; add 2% early-pay discount if possible.",
  },
  {
    // Rebate structure — tiered rebates should be transparent and attainable.
    category: "rebate_structure",
    patterns: [
      /rebate\s+(structure|tier|schedule)/i,
      /volume[-\s]based\s+rebate/i,
      /(tier(ed)?|incremental)\s+(rebate|discount)/i,
      /\d+(\.\d+)?\s*%\s+rebate/i,
    ],
    defaultRiskLevel: "medium",
    defaultFavorability: "neutral",
    requiredForRiskAnalysis: false,
    recommendedAction:
      "Model actual attainment vs each tier; demand flat % if top tier is unrealistic.",
  },
  {
    // Audit rights — facility must be able to verify invoices & rebate math.
    category: "audit_rights",
    patterns: [
      /audit\s+rights?/i,
      /right\s+to\s+audit/i,
      /inspect\s+(records|books)/i,
      /examine\s+.{0,30}\s+records/i,
    ],
    defaultRiskLevel: "low",
    defaultFavorability: "facility",
    requiredForRiskAnalysis: true,
    recommendedAction:
      "Require ≥2 audits/year at facility's discretion, with 10-business-day response SLA.",
  },
  {
    // Indemnification — who pays if third party sues. Must be mutual.
    category: "indemnification",
    patterns: [
      /indemnif(y|ication|ies)/i,
      /hold\s+harmless/i,
      /defend\s+and\s+indemnify/i,
    ],
    defaultRiskLevel: "medium",
    defaultFavorability: "neutral",
    requiredForRiskAnalysis: true,
    recommendedAction:
      "Make indemnification mutual; vendor must indemnify for IP + product-liability claims.",
  },
  {
    // Governing law — jurisdiction matters for dispute logistics + cost.
    category: "governing_law",
    patterns: [
      /governing\s+law/i,
      /governed\s+by\s+the\s+laws?\s+of/i,
      /laws?\s+of\s+the\s+state\s+of/i,
    ],
    defaultRiskLevel: "low",
    defaultFavorability: "neutral",
    requiredForRiskAnalysis: true,
    recommendedAction:
      "Prefer facility's home state; at minimum require neutral jurisdiction.",
  },
  {
    // Dispute resolution — arbitration vs litigation, venue, class-action waivers.
    category: "dispute_resolution",
    patterns: [
      /dispute\s+resolution/i,
      /binding\s+arbitration/i,
      /arbitration\s+(shall|will)\s+be/i,
      /class[-\s]action\s+waiver/i,
    ],
    defaultRiskLevel: "medium",
    defaultFavorability: "neutral",
    requiredForRiskAnalysis: false,
    recommendedAction:
      "Prefer mediation before arbitration; avoid class-action waivers.",
  },
  {
    // Assignment — can vendor sell the contract to a competitor or PE roll-up?
    category: "assignment",
    patterns: [
      /assign(ment)?\s+(of\s+)?(this\s+)?agreement/i,
      /shall\s+not\s+assign/i,
      /assign\s+.{0,30}\s+without\s+.{0,20}\s+consent/i,
    ],
    defaultRiskLevel: "medium",
    defaultFavorability: "neutral",
    requiredForRiskAnalysis: false,
    recommendedAction:
      "Require facility's written consent for any assignment; carve out change-of-control.",
  },
  {
    // Force majeure — protects both parties from unforeseeable events.
    category: "force_majeure",
    patterns: [
      /force\s+majeure/i,
      /act\s+of\s+god/i,
      /beyond\s+(the\s+)?(reasonable\s+)?control/i,
    ],
    defaultRiskLevel: "low",
    defaultFavorability: "neutral",
    requiredForRiskAnalysis: true,
    recommendedAction:
      "Include pandemic + supply-chain disruption explicitly; cap duration before exit right triggers.",
  },
  {
    // Confidentiality / NDA — protects facility's operational + patient data.
    category: "confidentiality",
    patterns: [
      /confidential(ity)?/i,
      /non[-\s]disclosure/i,
      /proprietary\s+information/i,
    ],
    defaultRiskLevel: "low",
    defaultFavorability: "neutral",
    requiredForRiskAnalysis: false,
    recommendedAction:
      "Ensure confidentiality survives termination for ≥5 years; PHI-specific carve-outs.",
  },
  {
    // Warranty — express warranties are better than 'AS IS' disclaimers.
    category: "warranty",
    patterns: [
      /warrant(y|ies)/i,
      /as\s+is(,|\s+)\s*where\s+is/i,
      /disclaim(s|er)\s+(all\s+)?warrant/i,
      /merchantability/i,
    ],
    defaultRiskLevel: "medium",
    defaultFavorability: "neutral",
    requiredForRiskAnalysis: false,
    recommendedAction:
      "Require express warranty of fitness-for-purpose; reject 'AS IS' disclaimers for critical items.",
  },
  {
    // Limitation of liability — caps vendor exposure. Watch for 1x-fees caps.
    category: "limitation_of_liability",
    patterns: [
      /limitation\s+of\s+liability/i,
      /liability\s+(shall|will)\s+(not\s+)?exceed/i,
      /(no|not)\s+liable\s+for\s+(any\s+)?(indirect|consequential|incidental|special)/i,
      /in\s+no\s+event\s+shall/i,
    ],
    defaultRiskLevel: "medium",
    defaultFavorability: "vendor",
    requiredForRiskAnalysis: true,
    recommendedAction:
      "Push liability cap to ≥2x annual fees; carve out IP + data-breach + gross negligence.",
  },
  {
    // IP ownership — critical when vendor creates work product (reports, software).
    category: "ip_ownership",
    patterns: [
      /intellectual\s+property/i,
      /ownership\s+of\s+(all\s+)?(work|deliverables)/i,
      /work[-\s]made[-\s]for[-\s]hire/i,
    ],
    defaultRiskLevel: "medium",
    defaultFavorability: "neutral",
    requiredForRiskAnalysis: false,
    recommendedAction:
      "Facility owns deliverables; vendor retains background IP with perpetual license to facility.",
  },
  {
    // Most-favored-nation — ensures facility gets vendor's best pricing.
    category: "most_favored_nation",
    patterns: [
      /most\s+favored\s+nation/i,
      /\bMFN\b/,
      /no\s+less\s+favorable\s+(terms|pricing)/i,
      /best\s+(customer\s+)?pric(e|ing)/i,
    ],
    defaultRiskLevel: "low",
    defaultFavorability: "facility",
    requiredForRiskAnalysis: false,
    recommendedAction:
      "Add MFN if not present; demand quarterly pricing attestation from vendor.",
  },
  {
    // Volume commitment — distinct from minimum-commit; measures tier attainment.
    category: "volume_commitment",
    patterns: [
      /volume\s+commitment/i,
      /annual\s+(volume|quantity)\s+of/i,
      /commit(ted)?\s+(annual\s+)?volume/i,
    ],
    defaultRiskLevel: "medium",
    defaultFavorability: "vendor",
    requiredForRiskAnalysis: false,
    recommendedAction:
      "Tie commitment to baseline-minus-safety-margin; no penalty for market-driven drops.",
  },
  {
    // Co-op marketing — vendor requires facility branding/marketing cooperation.
    category: "co_op_marketing",
    patterns: [
      /co[-\s]op\s+(marketing|advertising)/i,
      /marketing\s+(fund|contribution|allowance)/i,
      /joint\s+marketing/i,
    ],
    defaultRiskLevel: "low",
    defaultFavorability: "neutral",
    requiredForRiskAnalysis: false,
    recommendedAction:
      "Keep co-op participation optional; facility's branding approval required.",
  },
  {
    // Data rights — who owns usage / aggregate data from the vendor relationship.
    category: "data_rights",
    patterns: [
      /data\s+(rights|ownership|use)/i,
      /aggregate(d)?\s+data/i,
      /de[-\s]identified\s+data/i,
      /HIPAA/i,
    ],
    defaultRiskLevel: "high",
    defaultFavorability: "vendor",
    requiredForRiskAnalysis: false,
    recommendedAction:
      "Facility retains all raw + identifiable data; vendor may use de-identified aggregates only.",
  },
  {
    // Insurance — required coverage levels (general liability, cyber, product).
    category: "insurance",
    patterns: [
      /insurance\s+(requirements?|coverage)/i,
      /general\s+liability/i,
      /cyber\s+(liability|insurance)/i,
      /\$\d{1,3}(,\d{3})*\s+(in\s+)?coverage/i,
    ],
    defaultRiskLevel: "low",
    defaultFavorability: "facility",
    requiredForRiskAnalysis: false,
    recommendedAction:
      "Require ≥$1M general + $2M cyber + name facility as additional insured.",
  },
  {
    // Compliance representations — vendor attests to regulatory compliance.
    category: "compliance_reps",
    patterns: [
      /compliance\s+with\s+(all\s+)?(applicable\s+)?(laws|regulations)/i,
      /represents?\s+and\s+warrants?/i,
      /HIPAA|HITECH|OIG|CMS/i,
    ],
    defaultRiskLevel: "medium",
    defaultFavorability: "facility",
    requiredForRiskAnalysis: false,
    recommendedAction:
      "Require specific reps for HIPAA, OIG exclusion screening, and state licensure.",
  },
  {
    // Non-solicitation — protects facility's staff from vendor poaching.
    category: "non_solicitation",
    patterns: [
      /non[-\s]solicitation/i,
      /shall\s+not\s+solicit/i,
      /hire\s+any\s+employee/i,
    ],
    defaultRiskLevel: "low",
    defaultFavorability: "facility",
    requiredForRiskAnalysis: false,
    recommendedAction:
      "Include mutual 12-month non-solicit covering employees + key contractors.",
  },
  {
    // GPO affiliation — GPO contract triggers different pricing + admin fees.
    category: "gpo_affiliation",
    patterns: [
      /\bGPO\b/,
      /group\s+purchasing\s+organization/i,
      /admin(istrative)?\s+fee/i,
      /Vizient|Premier|HealthTrust|Intalere/i,
    ],
    defaultRiskLevel: "medium",
    defaultFavorability: "neutral",
    requiredForRiskAnalysis: false,
    recommendedAction:
      "Confirm admin-fee disclosure; verify GPO tier matches facility's actual membership.",
  },
] as const
