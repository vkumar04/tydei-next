/**
 * Canonical PDF contract clause-risk analyzer
 *
 * Implements Charles Weidman's `analyzePDFContract(clauses, side, variant, name)`
 * spec from the prospective-analysis canonical engine (email 2026-04-18).
 * Header summary: docs/superpowers/charles-canonical-engines/prospective-analysis.ts
 * Audit gap closed: docs/superpowers/audits/2026-05-04-prospective-analysis-audit.md
 *
 * This module is intentionally separate from
 * `lib/prospective-analysis/clause-library.ts` and `pdf-clause-analyzer.ts`
 * which already ship a different (regex-over-text, 0-10 score) analyzer used
 * by the Upload Proposal flow. This module is the structured *clause-list-in,
 * structured-result-out* analyzer that supports:
 *
 *   - 24 ClauseCategory values (incl. ANTI_KICKBACK, STARK_LAW, MFN,
 *     ANTI_STEERING)
 *   - RiskLevel with CRITICAL (vs the legacy LOW/MED/HIGH)
 *   - Per-ContractVariant REQUIRED_CLAUSES map
 *   - MISSING_CLAUSE_SUGGESTIONS with recommended legal language
 *   - Side-aware concerns/suggestions (vendor vs facility)
 *   - Cross-clause regulatory checks (Stark Law / anti-kickback / MFN /
 *     anti-steering / facility-side auto-renewal & price-protection)
 *   - 0-100 risk score with weights CRITICAL=25, HIGH=10, MEDIUM=5, LOW=1
 *
 * PURE FUNCTION: no IO, no Prisma, no Anthropic calls.
 *
 * Provenance note: the CLAUSE_RISK_LIBRARY entries below port what we have
 * from Charles's snapshot; categories where we do not have his exact prose
 * use industry-standard placeholder concerns/suggestions written here. The
 * shape, weights, REQUIRED_CLAUSES table, and MISSING_CLAUSE_SUGGESTIONS
 * structure all match the canonical brief.
 */

// ---------------------------------------------------------------------------
// Type surface
// ---------------------------------------------------------------------------

export type ClauseCategory =
  | "PRICING"
  | "REBATE"
  | "TERM_AND_RENEWAL"
  | "TERMINATION"
  | "COMPLIANCE"
  | "MINIMUM_COMMITMENT"
  | "PRICE_PROTECTION"
  | "MOST_FAVORED_NATION"
  | "AUTO_RENEWAL"
  | "INDEMNIFICATION"
  | "DISPUTE_RESOLUTION"
  | "AUDIT_RIGHTS"
  | "DATA_AND_HIPAA"
  | "EXCLUSIVITY"
  | "ANTI_STEERING"
  | "CONFIDENTIALITY"
  | "CAPITAL_MAINTENANCE"
  | "SLA"
  | "FORCE_MAJEURE"
  | "GOVERNING_LAW"
  | "ANTI_KICKBACK"
  | "STARK_LAW"
  | "MISSING"
  | "OTHER"

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"

export type UserSide = "VENDOR" | "FACILITY"

/**
 * 13 contract variants per Charles's brief. Maps to tydei's existing
 * `ContractType` x `TermType` matrix but is the canonical UI-facing set.
 */
export type ContractVariant =
  | "USAGE_SPEND"
  | "USAGE_VOLUME"
  | "USAGE_CARVEOUT"
  | "USAGE_MARKET_SHARE"
  | "USAGE_CAPITATED"
  | "USAGE_TIEIN"
  | "CAPITAL_PURCHASE"
  | "CAPITAL_LEASE"
  | "CAPITAL_TIEIN"
  | "SERVICE_MAINTENANCE"
  | "SERVICE_FULL"
  | "GPO"
  | "PRICING_ONLY"

/**
 * Minimal extracted clause shape — caller is responsible for upstream
 * regex/Claude extraction. The analyzer assumes `category` is set.
 */
export interface ContractClause {
  category: ClauseCategory
  /** Verbatim or near-verbatim clause text. Optional context only. */
  text?: string
  /** Optional override risk detected upstream (e.g., from Claude). */
  detectedRiskLevel?: RiskLevel
}

/** Library entry — the substrate the analyzer reads from. */
export interface ClauseLibraryEntry {
  category: ClauseCategory
  /** Default risk when this clause is present. */
  baseRisk: RiskLevel
  /** True if this clause is "standard boilerplate" — its presence is expected. */
  isStandard: boolean
  /** Optional regulatory hook (e.g., "Stark Law", "Anti-Kickback Statute"). */
  regulatoryImplication?: string
  /** Concerns / suggestions framed for each side of the contract. */
  vendorConcerns: string[]
  facilityConcerns: string[]
  vendorSuggestions: string[]
  facilitySuggestions: string[]
}

/**
 * One assessment per CLAUSE the analyzer evaluated (whether present or
 * absent). Side-aware text picks vendor/facility concerns.
 */
export interface ClauseRiskAssessment {
  category: ClauseCategory
  riskLevel: RiskLevel
  isPresent: boolean
  /** Concerns shown to the active side. */
  concerns: string[]
  /** Suggestions shown to the active side. */
  suggestions: string[]
  /** Optional regulatory tag for surfaced flags. */
  regulatoryImplication?: string
  /** True when the clause is favorable for the active side. */
  isFavorable: boolean
}

/** Alert payload for a missing required clause. */
export interface MissingClauseAlert {
  category: ClauseCategory
  riskLevel: RiskLevel
  /** Why the clause matters to the active side. */
  reason: string
  /** Recommended language to demand from the counterparty. */
  recommendedLanguage: string
}

/** Cross-clause regulatory or strategic flag. */
export interface CriticalFlag {
  category: ClauseCategory
  riskLevel: RiskLevel
  message: string
  regulatoryImplication?: string
}

export interface PDFContractAnalysisResult {
  contractName: string
  side: UserSide
  contractVariant: ContractVariant
  clauseAssessments: ClauseRiskAssessment[]
  missingClauses: MissingClauseAlert[]
  /** 0-100 weighted aggregate; see RISK_WEIGHTS. */
  overallRiskScore: number
  overallRiskLevel: RiskLevel
  criticalFlags: CriticalFlag[]
  favorableTerms: ClauseCategory[]
  /** Ordered list of categories the active side should push hardest on. */
  negotiationPriorities: ClauseCategory[]
  summary: string
}

// ---------------------------------------------------------------------------
// CLAUSE_RISK_LIBRARY
// ---------------------------------------------------------------------------

/**
 * Per-category vendor/facility concerns + suggestions + base risk.
 *
 * Provenance: structure mirrors Charles's CLAUSE_RISK_LIBRARY from the
 * 2026-04-18 canonical email. Where his exact prose was not committed to
 * the in-repo snapshot, entries below use industry-standard healthcare
 * contracting language reviewed against the audit doc. Replace with his
 * verbatim text when the full source lands in
 * `docs/superpowers/charles-canonical-engines/`.
 */
export const CLAUSE_RISK_LIBRARY: Record<ClauseCategory, ClauseLibraryEntry> = {
  PRICING: {
    category: "PRICING",
    baseRisk: "MEDIUM",
    isStandard: true,
    vendorConcerns: [
      "Pricing exposure to inflation across multi-year term",
      "Margin compression if facility volume falls below baseline",
    ],
    facilityConcerns: [
      "Mid-term price increases without index cap",
      "Hidden fees or surcharges layered on list",
    ],
    vendorSuggestions: [
      "Include CPI-linked annual escalator with floor",
      "Tie pricing tier to volume ranges with clear breakpoints",
    ],
    facilitySuggestions: [
      "Lock pricing for term, or cap escalation at lesser of CPI/3%",
      "Require all-in pricing — no separate freight, admin, or compliance fees",
    ],
  },
  REBATE: {
    category: "REBATE",
    baseRisk: "MEDIUM",
    isStandard: true,
    vendorConcerns: [
      "Tier acceleration eroding margin if facility over-performs",
      "Rebate float costs if payment terms exceed 60 days",
    ],
    facilityConcerns: [
      "Top-tier thresholds set above realistic attainment",
      "Rebate offset against future invoices instead of cash payout",
    ],
    vendorSuggestions: [
      "Offer flat rebate with growth-based bonus instead of stacked tiers",
      "Quarterly true-up with 30-day payment SLA",
    ],
    facilitySuggestions: [
      "Model attainment vs each tier; demand flat % if top tier is unrealistic",
      "Require cash rebate (not credit memo) within 45 days of period close",
    ],
  },
  TERM_AND_RENEWAL: {
    category: "TERM_AND_RENEWAL",
    baseRisk: "LOW",
    isStandard: true,
    vendorConcerns: [
      "Short term with no renewal option erodes deal economics",
    ],
    facilityConcerns: [
      "Long initial term locks facility into stale pricing",
    ],
    vendorSuggestions: [
      "3-year initial with mutual 1-year extensions",
    ],
    facilitySuggestions: [
      "Cap initial term at 3 years; require explicit renewal vote",
    ],
  },
  TERMINATION: {
    category: "TERMINATION",
    baseRisk: "MEDIUM",
    isStandard: true,
    vendorConcerns: [
      "Termination-for-convenience exposes vendor to stranded inventory",
      "Asymmetric cure periods favoring facility",
    ],
    facilityConcerns: [
      "No termination-for-convenience right",
      "Early-termination penalties tied to remaining-term value",
    ],
    vendorSuggestions: [
      "Limit termination-for-convenience to anniversary dates with 90-day notice",
      "Symmetric 30-day cure periods for material breach",
    ],
    facilitySuggestions: [
      "Demand termination-for-convenience with 30-60 day notice and no penalty",
      "Cap any wind-down fees at 1 month of run-rate",
    ],
  },
  COMPLIANCE: {
    category: "COMPLIANCE",
    baseRisk: "MEDIUM",
    isStandard: true,
    vendorConcerns: [
      "Open-ended regulatory-change cost-shift to vendor",
    ],
    facilityConcerns: [
      "Vendor not bound to OIG / CMS / state-licensure changes during term",
    ],
    vendorSuggestions: [
      "Material regulatory change triggers good-faith renegotiation",
    ],
    facilitySuggestions: [
      "Vendor reps include OIG exclusion screening and HIPAA BAA where applicable",
    ],
  },
  MINIMUM_COMMITMENT: {
    category: "MINIMUM_COMMITMENT",
    baseRisk: "HIGH",
    isStandard: false,
    vendorConcerns: [
      "Facility under-commits, leaving capacity stranded",
    ],
    facilityConcerns: [
      "Shortfall fees triggered by market-driven volume drops",
      "Minimum set above 12-month historical baseline",
    ],
    vendorSuggestions: [
      "Tie minimum to baseline +5% with quarterly true-up",
    ],
    facilitySuggestions: [
      "Anchor minimum at baseline -15-20% safety margin",
      "Carve out force-majeure / pandemic / case-mix shifts from shortfall calc",
    ],
  },
  PRICE_PROTECTION: {
    category: "PRICE_PROTECTION",
    baseRisk: "LOW",
    isStandard: false,
    vendorConcerns: [
      "Facility-favorable price cap eats vendor margin in inflationary cycles",
    ],
    facilityConcerns: [
      "No cap on mid-term price increases",
    ],
    vendorSuggestions: [
      "Cap escalation at CPI + 1%, but with 3% floor in inflationary years",
    ],
    facilitySuggestions: [
      "Require fixed pricing for term, or cap at lesser of CPI / 3% annually",
      "Apply cap to ALL line-items, not just headline SKUs",
    ],
  },
  MOST_FAVORED_NATION: {
    category: "MOST_FAVORED_NATION",
    baseRisk: "HIGH",
    isStandard: false,
    regulatoryImplication:
      "MFN clauses can attract antitrust scrutiny and complicate downstream pricing strategy.",
    vendorConcerns: [
      "MFN obligation forces retroactive pricing adjustments across book",
      "MFN scope (national / regional / channel) is critical to margin model",
    ],
    facilityConcerns: [
      "No MFN means facility may not get vendor's best available pricing",
    ],
    vendorSuggestions: [
      "Reject MFN entirely, or limit to a narrow comparable-customer cohort",
      "Define 'comparable' tightly: same size, geography, term length, volume tier",
    ],
    facilitySuggestions: [
      "Demand MFN with quarterly attestation and audit right",
      "Define comparable-customer cohort generously (any IDN of similar size)",
    ],
  },
  AUTO_RENEWAL: {
    category: "AUTO_RENEWAL",
    baseRisk: "HIGH",
    isStandard: false,
    vendorConcerns: [
      "Facility may try to strip auto-renewal during negotiation",
    ],
    facilityConcerns: [
      "Auto-renewal traps facility into rollover terms with stale pricing",
      "Non-renewal notice windows shorter than 60 days are ops-impractical",
    ],
    vendorSuggestions: [
      "Keep auto-renewal with 60-day non-renewal window",
    ],
    facilitySuggestions: [
      "Replace auto-renewal with affirmative opt-in renewal",
      "If unavoidable, demand 90-day non-renewal window and email + certified-mail notice options",
    ],
  },
  INDEMNIFICATION: {
    category: "INDEMNIFICATION",
    baseRisk: "MEDIUM",
    isStandard: true,
    vendorConcerns: [
      "Broad facility-favoring indemnity for IP, product-liability, or PHI breach",
    ],
    facilityConcerns: [
      "Vendor indemnity capped at fees-paid is meaningless for major incidents",
      "No indemnification for vendor's negligence or IP infringement",
    ],
    vendorSuggestions: [
      "Mutual indemnification with per-occurrence cap at 2x annual fees",
    ],
    facilitySuggestions: [
      "Vendor uncapped indemnity for IP, gross-negligence, willful misconduct, and PHI breach",
      "Vendor defense obligation triggers on tender of claim",
    ],
  },
  DISPUTE_RESOLUTION: {
    category: "DISPUTE_RESOLUTION",
    baseRisk: "LOW",
    isStandard: true,
    vendorConcerns: [
      "Class-action exposure if waiver missing",
    ],
    facilityConcerns: [
      "Forced arbitration in vendor's home jurisdiction",
      "Fee-shifting language disadvantaging facility",
    ],
    vendorSuggestions: [
      "Binding arbitration in vendor's HQ state under AAA rules",
    ],
    facilitySuggestions: [
      "Mediation first; arbitration in neutral venue; each party bears own costs",
    ],
  },
  AUDIT_RIGHTS: {
    category: "AUDIT_RIGHTS",
    baseRisk: "LOW",
    isStandard: true,
    vendorConcerns: [
      "Open-ended audit rights disrupt vendor operations",
      "Facility uses audit results to renegotiate mid-term",
    ],
    facilityConcerns: [
      "No audit rights = no way to verify rebate math, invoice accuracy, or MFN compliance",
    ],
    vendorSuggestions: [
      "Limit audits to 1/year, on 30-day notice, during business hours",
    ],
    facilitySuggestions: [
      "Demand 2 audits/year at facility's discretion with 10-business-day response SLA",
      "Audit cost shifts to vendor if discrepancy >5%",
    ],
  },
  DATA_AND_HIPAA: {
    category: "DATA_AND_HIPAA",
    baseRisk: "HIGH",
    isStandard: true,
    regulatoryImplication: "HIPAA / HITECH / state PHI breach laws.",
    vendorConcerns: [
      "Broad data-rights restriction blocks vendor's analytics product",
    ],
    facilityConcerns: [
      "Vendor claims rights to aggregate / de-identified data without facility consent",
      "No Business Associate Agreement (BAA) where PHI is in scope",
    ],
    vendorSuggestions: [
      "Vendor retains right to use de-identified, aggregated data for product improvement",
    ],
    facilitySuggestions: [
      "Facility owns all raw + identifiable data; vendor must execute BAA",
      "Vendor may not sell or share aggregated data without written consent",
    ],
  },
  EXCLUSIVITY: {
    category: "EXCLUSIVITY",
    baseRisk: "HIGH",
    isStandard: false,
    vendorConcerns: [
      "Facility refuses exclusivity, opening door to multi-source competition",
    ],
    facilityConcerns: [
      "Exclusivity blocks alternative suppliers when vendor performance drops",
      "No market-shift escape clause if a better technology launches",
    ],
    vendorSuggestions: [
      "Exclusivity for named SKUs with 95% wallet-share commitment",
    ],
    facilitySuggestions: [
      "Reject exclusivity; or limit to specific SKUs with market-shift exit right",
      "Carve-out for clinically-required alternatives",
    ],
  },
  ANTI_STEERING: {
    category: "ANTI_STEERING",
    baseRisk: "HIGH",
    isStandard: false,
    regulatoryImplication:
      "Anti-steering clauses attract scrutiny under federal antitrust law, especially for facilities accepting CMS reimbursement.",
    vendorConcerns: [
      "Anti-steering compliance costs and restrictions on vendor sales tactics",
    ],
    facilityConcerns: [
      "Anti-steering clause prevents facility from directing patients to lower-cost alternatives",
      "Restricts facility's ability to recommend clinically-appropriate substitutes",
    ],
    vendorSuggestions: [
      "Narrow anti-steering to specific competitive SKUs only",
    ],
    facilitySuggestions: [
      "Reject anti-steering provisions entirely — they may violate antitrust and patient-choice principles",
      "If unavoidable, limit to non-clinical promotional steering only",
    ],
  },
  CONFIDENTIALITY: {
    category: "CONFIDENTIALITY",
    baseRisk: "LOW",
    isStandard: true,
    vendorConcerns: [
      "Facility shares vendor pricing with GPO or peer facilities",
    ],
    facilityConcerns: [
      "Confidentiality obligation prevents disclosure to legal or regulators",
    ],
    vendorSuggestions: [
      "Mutual NDA surviving 5 years post-termination; pricing is highly confidential",
    ],
    facilitySuggestions: [
      "Carve out disclosures to legal counsel, auditors, regulators, and corporate parent",
    ],
  },
  CAPITAL_MAINTENANCE: {
    category: "CAPITAL_MAINTENANCE",
    baseRisk: "MEDIUM",
    isStandard: false,
    vendorConcerns: [
      "Open-ended maintenance commitment with no SLA limits exposure",
    ],
    facilityConcerns: [
      "Maintenance obligation ends before useful-life of capital equipment",
      "No service-level guarantees for response or uptime",
    ],
    vendorSuggestions: [
      "Bundle maintenance with consumables purchase; reduce price if maintenance unbundled",
    ],
    facilitySuggestions: [
      "Maintenance for 100% of equipment useful-life (typically 7-10 years)",
      "Define uptime SLA (≥98%) and parts-availability SLA",
    ],
  },
  SLA: {
    category: "SLA",
    baseRisk: "MEDIUM",
    isStandard: false,
    vendorConcerns: [
      "SLA penalties uncapped or stacked across multiple metrics",
    ],
    facilityConcerns: [
      "No measurable performance commitments",
      "SLA credits offered as future invoice credits, not cash",
    ],
    vendorSuggestions: [
      "SLA penalties capped at 10% of monthly fees, single-metric",
    ],
    facilitySuggestions: [
      "Defined uptime, response-time, and resolution-time SLAs",
      "Service credits issued as cash refund or invoice credit at facility's election",
    ],
  },
  FORCE_MAJEURE: {
    category: "FORCE_MAJEURE",
    baseRisk: "LOW",
    isStandard: true,
    vendorConcerns: [
      "Facility uses force-majeure to justify volume drops not actually caused by event",
    ],
    facilityConcerns: [
      "Force-majeure narrowly defined, excluding pandemic / supply-chain disruption",
      "No exit right if force-majeure persists beyond 60-90 days",
    ],
    vendorSuggestions: [
      "Standard force-majeure with 30-day cure obligation",
    ],
    facilitySuggestions: [
      "Include pandemic + supply-chain disruption explicitly in covered events",
      "Termination right if force-majeure persists 90+ days",
    ],
  },
  GOVERNING_LAW: {
    category: "GOVERNING_LAW",
    baseRisk: "LOW",
    isStandard: true,
    vendorConcerns: [
      "Litigating in facility's jurisdiction inflates legal cost",
    ],
    facilityConcerns: [
      "Vendor's home jurisdiction may have unfavorable case law",
    ],
    vendorSuggestions: [
      "Vendor's HQ state with exclusive venue",
    ],
    facilitySuggestions: [
      "Facility's home state, or neutral state with no party-favoring case law",
    ],
  },
  ANTI_KICKBACK: {
    // baseRisk reflects the risk when the clause IS present (i.e., the
    // representation has been made). The CRITICAL exposure for ABSENT
    // ANTI_KICKBACK reps is handled via REQUIRED_CLAUSES + the cross-clause
    // criticalFlags path so we don't double-count.
    category: "ANTI_KICKBACK",
    baseRisk: "MEDIUM",
    isStandard: true,
    regulatoryImplication:
      "Federal Anti-Kickback Statute (42 U.S.C. § 1320a-7b). Violations carry criminal penalties, civil monetary penalties, and exclusion from federal healthcare programs.",
    vendorConcerns: [
      "Rebate or fee structures must fit within a Safe Harbor (e.g., discount, GPO, personal-services)",
      "Free goods or services bundled with paid items can be construed as remuneration",
    ],
    facilityConcerns: [
      "Vendor incentives that may induce referrals or purchases of items billable to federal programs",
      "No written certification of Safe Harbor fit on the deal structure",
    ],
    vendorSuggestions: [
      "Structure rebates to fit the Discount Safe Harbor (42 C.F.R. § 1001.952(h))",
      "Disclose all rebates / admin fees on invoice; pass through to facility's cost reports",
    ],
    facilitySuggestions: [
      "Require vendor representation that the entire deal structure complies with the Anti-Kickback Statute",
      "Demand written Safe Harbor analysis from vendor's healthcare counsel",
      "Require pass-through disclosure of all discounts on cost reports",
    ],
  },
  STARK_LAW: {
    // baseRisk = risk when the Stark exception is identified (clause IS
    // present). Strict-liability CRITICAL exposure for ABSENT Stark
    // language is handled by the cross-clause flag for capital/tie-in
    // variants.
    category: "STARK_LAW",
    baseRisk: "MEDIUM",
    isStandard: true,
    regulatoryImplication:
      "Physician Self-Referral Law (42 U.S.C. § 1395nn). Strict-liability statute — even unintentional violations create overpayment + False Claims Act exposure.",
    vendorConcerns: [
      "Capital deals with physician-owned facilities require Stark exception (e.g., fair-market-value, set-in-advance)",
      "Tie-in arrangements with referring-physician entities are high-risk",
    ],
    facilityConcerns: [
      "No Stark Law exception identified for capital / tie-in / equipment-share deals",
      "Pricing or terms not set at fair market value, set in advance, and commercially reasonable",
    ],
    vendorSuggestions: [
      "Structure capital + tie-in deals to fit a Stark exception (FMV, equipment-rental, personal-services)",
      "Annual FMV opinion from independent valuation firm",
    ],
    facilitySuggestions: [
      "Require written Stark Law exception identification and FMV documentation",
      "All capital and tie-in pricing must be set in advance and commercially reasonable without regard to referrals",
      "Annual compliance attestation from vendor's healthcare counsel",
    ],
  },
  MISSING: {
    category: "MISSING",
    baseRisk: "MEDIUM",
    isStandard: false,
    vendorConcerns: [],
    facilityConcerns: [],
    vendorSuggestions: [],
    facilitySuggestions: [],
  },
  OTHER: {
    category: "OTHER",
    baseRisk: "LOW",
    isStandard: false,
    vendorConcerns: [],
    facilityConcerns: [],
    vendorSuggestions: [],
    facilitySuggestions: [],
  },
}

// ---------------------------------------------------------------------------
// REQUIRED_CLAUSES per ContractVariant
// ---------------------------------------------------------------------------

/**
 * Per-variant required clauses. Absence of any of these triggers a
 * MissingClauseAlert during analysis.
 *
 * Provenance: structure mirrors Charles's REQUIRED_CLAUSES table. The
 * specific category lists below reflect standard healthcare-contracting
 * practice — capital / tie-in deals add STARK_LAW + ANTI_KICKBACK, GPO
 * adds disclosure boilerplate, etc. Adjust to Charles's verbatim list
 * when the full source lands.
 */
export const REQUIRED_CLAUSES: Record<ContractVariant, ClauseCategory[]> = {
  USAGE_SPEND: [
    "PRICING",
    "REBATE",
    "TERM_AND_RENEWAL",
    "TERMINATION",
    "AUDIT_RIGHTS",
    "INDEMNIFICATION",
    "GOVERNING_LAW",
    "ANTI_KICKBACK",
  ],
  USAGE_VOLUME: [
    "PRICING",
    "REBATE",
    "MINIMUM_COMMITMENT",
    "TERM_AND_RENEWAL",
    "TERMINATION",
    "AUDIT_RIGHTS",
    "INDEMNIFICATION",
    "GOVERNING_LAW",
    "ANTI_KICKBACK",
  ],
  USAGE_CARVEOUT: [
    "PRICING",
    "REBATE",
    "TERM_AND_RENEWAL",
    "TERMINATION",
    "AUDIT_RIGHTS",
    "INDEMNIFICATION",
    "GOVERNING_LAW",
    "ANTI_KICKBACK",
  ],
  USAGE_MARKET_SHARE: [
    "PRICING",
    "REBATE",
    "EXCLUSIVITY",
    "TERM_AND_RENEWAL",
    "TERMINATION",
    "AUDIT_RIGHTS",
    "INDEMNIFICATION",
    "GOVERNING_LAW",
    "ANTI_KICKBACK",
  ],
  USAGE_CAPITATED: [
    "PRICING",
    "REBATE",
    "MINIMUM_COMMITMENT",
    "TERM_AND_RENEWAL",
    "TERMINATION",
    "AUDIT_RIGHTS",
    "INDEMNIFICATION",
    "GOVERNING_LAW",
    "ANTI_KICKBACK",
  ],
  USAGE_TIEIN: [
    "PRICING",
    "REBATE",
    "MINIMUM_COMMITMENT",
    "CAPITAL_MAINTENANCE",
    "TERM_AND_RENEWAL",
    "TERMINATION",
    "AUDIT_RIGHTS",
    "INDEMNIFICATION",
    "GOVERNING_LAW",
    "ANTI_KICKBACK",
    "STARK_LAW",
  ],
  CAPITAL_PURCHASE: [
    "PRICING",
    "CAPITAL_MAINTENANCE",
    "SLA",
    "TERM_AND_RENEWAL",
    "TERMINATION",
    "AUDIT_RIGHTS",
    "INDEMNIFICATION",
    "GOVERNING_LAW",
    "ANTI_KICKBACK",
    "STARK_LAW",
  ],
  CAPITAL_LEASE: [
    "PRICING",
    "CAPITAL_MAINTENANCE",
    "SLA",
    "TERM_AND_RENEWAL",
    "TERMINATION",
    "AUDIT_RIGHTS",
    "INDEMNIFICATION",
    "GOVERNING_LAW",
    "ANTI_KICKBACK",
    "STARK_LAW",
  ],
  CAPITAL_TIEIN: [
    "PRICING",
    "REBATE",
    "MINIMUM_COMMITMENT",
    "CAPITAL_MAINTENANCE",
    "SLA",
    "TERM_AND_RENEWAL",
    "TERMINATION",
    "AUDIT_RIGHTS",
    "INDEMNIFICATION",
    "GOVERNING_LAW",
    "ANTI_KICKBACK",
    "STARK_LAW",
  ],
  SERVICE_MAINTENANCE: [
    "PRICING",
    "SLA",
    "TERM_AND_RENEWAL",
    "TERMINATION",
    "AUDIT_RIGHTS",
    "INDEMNIFICATION",
    "GOVERNING_LAW",
  ],
  SERVICE_FULL: [
    "PRICING",
    "SLA",
    "DATA_AND_HIPAA",
    "TERM_AND_RENEWAL",
    "TERMINATION",
    "AUDIT_RIGHTS",
    "INDEMNIFICATION",
    "GOVERNING_LAW",
    "ANTI_KICKBACK",
  ],
  GPO: [
    "PRICING",
    "REBATE",
    "TERM_AND_RENEWAL",
    "TERMINATION",
    "AUDIT_RIGHTS",
    "GOVERNING_LAW",
    "ANTI_KICKBACK",
  ],
  PRICING_ONLY: [
    "PRICING",
    "TERM_AND_RENEWAL",
    "TERMINATION",
    "GOVERNING_LAW",
  ],
}

// ---------------------------------------------------------------------------
// MISSING_CLAUSE_SUGGESTIONS — recommended language for what to demand
// ---------------------------------------------------------------------------

/**
 * Per-category recommended language to demand when the clause is missing.
 *
 * Provenance: structure mirrors Charles's MISSING_CLAUSE_SUGGESTIONS table.
 * Recommended-language strings are written here as starter language and
 * should be replaced with Charles's verbatim text once the full source
 * lands. Keep entries reviewable by counsel before sending to a vendor.
 */
export const MISSING_CLAUSE_SUGGESTIONS: Partial<
  Record<ClauseCategory, MissingClauseAlert>
> = {
  PRICE_PROTECTION: {
    category: "PRICE_PROTECTION",
    riskLevel: "HIGH",
    reason:
      "Without a price-protection clause, the vendor can raise unit prices mid-term and erase rebate value.",
    recommendedLanguage:
      "Vendor agrees that unit prices set forth in Exhibit A shall remain firm for the initial Term. Any subsequent increase shall not exceed the lesser of (i) the percentage change in the U.S. CPI-U (All Urban Consumers) over the prior twelve months, or (ii) three percent (3%) per annum. Vendor shall provide ninety (90) days' written notice before any price change and apply caps to all line items, not solely the headline SKUs.",
  },
  AUDIT_RIGHTS: {
    category: "AUDIT_RIGHTS",
    riskLevel: "HIGH",
    reason:
      "Without audit rights, the facility cannot verify invoice accuracy, rebate computations, or MFN compliance.",
    recommendedLanguage:
      "Facility, or its designee, shall have the right, upon thirty (30) days' written notice, to audit Vendor's books and records relating to this Agreement up to two (2) times per Contract Year, during normal business hours. Vendor shall respond to audit findings within ten (10) business days. If the audit reveals a discrepancy in Facility's favor exceeding five percent (5%) of audited amounts, Vendor shall reimburse Facility's reasonable audit costs in addition to the underpayment.",
  },
  INDEMNIFICATION: {
    category: "INDEMNIFICATION",
    riskLevel: "HIGH",
    reason:
      "Without an indemnification clause, the facility bears unlimited exposure for vendor-caused harms.",
    recommendedLanguage:
      "Vendor shall defend, indemnify, and hold harmless Facility, its affiliates, officers, directors, employees, and agents from and against any and all third-party claims, damages, liabilities, and expenses (including reasonable attorneys' fees) arising out of or related to (i) Vendor's breach of this Agreement, (ii) Vendor's negligence or willful misconduct, (iii) any claim that Vendor's products or services infringe any third-party intellectual property right, or (iv) any breach of protected health information caused by Vendor. Vendor's indemnification obligations under (iii) and (iv) shall be uncapped.",
  },
  GOVERNING_LAW: {
    category: "GOVERNING_LAW",
    riskLevel: "MEDIUM",
    reason:
      "Without a governing-law clause, dispute venue and applicable law are uncertain.",
    recommendedLanguage:
      "This Agreement shall be governed by and construed in accordance with the laws of the State of [Facility's home state], without regard to its conflict-of-laws principles. Each party irrevocably consents to the exclusive jurisdiction of the state and federal courts located in [Facility's home county] for any action arising out of or related to this Agreement.",
  },
  TERMINATION: {
    category: "TERMINATION",
    riskLevel: "HIGH",
    reason:
      "Without a termination clause, the facility cannot exit the contract for vendor non-performance or strategic reasons.",
    recommendedLanguage:
      "Either party may terminate this Agreement (i) for material breach upon thirty (30) days' written notice, provided the breaching party has not cured such breach within the notice period; or (ii) for convenience upon sixty (60) days' written notice, with no early-termination fee or penalty. Upon termination, Vendor shall continue to honor pricing and service levels for any open purchase orders.",
  },
  STARK_LAW: {
    category: "STARK_LAW",
    riskLevel: "CRITICAL",
    reason:
      "For capital, tie-in, or equipment-share arrangements involving physician-owned or physician-affiliated facilities, Stark Law is strict-liability. Absence of an exception identification creates immediate False Claims Act exposure.",
    recommendedLanguage:
      "Vendor represents and warrants that the financial arrangement set forth in this Agreement is structured to fit within an exception to the Physician Self-Referral Law (42 U.S.C. § 1395nn) and its implementing regulations, including specifically the [Equipment Rental / Personal Services / Fair Market Value] exception at 42 C.F.R. § 411.357. All compensation hereunder is set in advance, consistent with fair market value as supported by the independent valuation report attached as Exhibit [__], and does not take into account the volume or value of any referrals or other business generated between the parties. Vendor shall provide an annual updated FMV opinion and compliance attestation from qualified healthcare counsel.",
  },
  ANTI_KICKBACK: {
    category: "ANTI_KICKBACK",
    riskLevel: "CRITICAL",
    reason:
      "The federal Anti-Kickback Statute (42 U.S.C. § 1320a-7b) is criminal. Any rebate, discount, or in-kind item must fit a Safe Harbor or be supported by counsel's analysis.",
    recommendedLanguage:
      "Vendor represents and warrants that all discounts, rebates, and other remuneration provided under this Agreement are intended to comply with the Discount Safe Harbor (42 C.F.R. § 1001.952(h)) or another applicable Safe Harbor under the federal Anti-Kickback Statute. Vendor shall (i) fully and accurately disclose all such discounts on invoices in a manner that permits Facility to report them properly on cost reports submitted to federal healthcare programs, (ii) inform Facility of its obligation to report the discounts, and (iii) refrain from any arrangement that conditions any benefit on referrals.",
  },
  DATA_AND_HIPAA: {
    category: "DATA_AND_HIPAA",
    riskLevel: "CRITICAL",
    reason:
      "Where Vendor handles or has access to Protected Health Information, HIPAA / HITECH require an executed Business Associate Agreement and clear data-ownership terms.",
    recommendedLanguage:
      "To the extent Vendor creates, receives, maintains, or transmits Protected Health Information on behalf of Facility, the parties shall execute the Business Associate Agreement attached as Exhibit [__] concurrently with this Agreement. Facility shall retain sole ownership of all raw and identifiable data, including all PHI. Vendor may use de-identified, aggregated data solely for Vendor's internal analytics and product improvement, and shall not sell or share such data with any third party without Facility's prior written consent.",
  },
  AUTO_RENEWAL: {
    category: "AUTO_RENEWAL",
    riskLevel: "MEDIUM",
    reason:
      "If the contract has a renewal mechanism, an explicit non-renewal window protects the facility from inadvertent rollover at stale pricing.",
    recommendedLanguage:
      "This Agreement shall not auto-renew. Any renewal shall require an affirmative written agreement signed by both parties at least sixty (60) days before the end of the then-current Term. If the parties do not execute a renewal, this Agreement shall expire at the end of the current Term without further action.",
  },
  CAPITAL_MAINTENANCE: {
    category: "CAPITAL_MAINTENANCE",
    riskLevel: "HIGH",
    reason:
      "For capital deals, absence of a maintenance commitment leaves the facility exposed to mid-life equipment-failure cost.",
    recommendedLanguage:
      "Vendor shall provide preventive maintenance, parts, and repair services for the Equipment for the entirety of its useful life (defined as no fewer than seven (7) years from installation). Vendor shall maintain a minimum equipment uptime of ninety-eight percent (98%) measured monthly, and shall respond to any service call within four (4) business hours.",
  },
  SLA: {
    category: "SLA",
    riskLevel: "MEDIUM",
    reason:
      "Without measurable SLAs, the facility has no recourse for vendor under-performance short of breach termination.",
    recommendedLanguage:
      "Vendor shall meet the Service Level Agreements set forth in Exhibit [__], including without limitation a minimum monthly availability of ninety-nine percent (99%), an initial response time of no more than two (2) business hours for priority incidents, and resolution of priority incidents within eight (8) business hours. Failure to meet any SLA shall entitle Facility to service credits as set forth in Exhibit [__], payable as cash refund or invoice credit at Facility's election.",
  },
  ANTI_STEERING: {
    category: "ANTI_STEERING",
    riskLevel: "MEDIUM",
    reason:
      "Where the proposal contemplates restrictions on Facility's ability to recommend alternatives, an explicit carve-out preserves clinical judgment and patient choice.",
    recommendedLanguage:
      "Nothing in this Agreement shall restrict Facility, its physicians, or its clinical staff from recommending, ordering, or providing any product or service that the recommending clinician believes, in their independent medical judgment, to be in the best interest of the patient.",
  },
  MOST_FAVORED_NATION: {
    category: "MOST_FAVORED_NATION",
    riskLevel: "MEDIUM",
    reason:
      "An MFN clause ensures the facility receives the vendor's best available pricing across comparable customers.",
    recommendedLanguage:
      "If, during the Term, Vendor offers to any Comparable Customer pricing or terms more favorable than those provided to Facility under this Agreement, Vendor shall promptly notify Facility and extend such pricing or terms to Facility on a prospective basis. 'Comparable Customer' means any healthcare facility or system of similar size and contract structure. Facility shall have the right, upon thirty (30) days' notice, to audit Vendor's compliance with this Section once per Contract Year.",
  },
  EXCLUSIVITY: {
    category: "EXCLUSIVITY",
    riskLevel: "MEDIUM",
    reason:
      "Where market-share variants imply exclusivity, an explicit definition prevents disputes over scope.",
    recommendedLanguage:
      "Facility's market-share commitment under this Agreement applies solely to the SKUs listed in Exhibit [__]. Facility retains the right to purchase clinically-required alternatives, technologies not yet available from Vendor, and any product not on the Exhibit [__] list, without breach of this Agreement.",
  },
}

// ---------------------------------------------------------------------------
// Risk-score weights & helpers
// ---------------------------------------------------------------------------

/** Charles's canonical weights: CRITICAL=25, HIGH=10, MEDIUM=5, LOW=1. */
export const RISK_WEIGHTS: Record<RiskLevel, number> = {
  CRITICAL: 25,
  HIGH: 10,
  MEDIUM: 5,
  LOW: 1,
}

/** Map an integer 0-100 score onto an overall RiskLevel band. */
function scoreToOverallRiskLevel(score: number): RiskLevel {
  if (score >= 60) return "CRITICAL"
  if (score >= 35) return "HIGH"
  if (score >= 15) return "MEDIUM"
  return "LOW"
}

/**
 * Side-aware favorability heuristic. A clause is "favorable" for the
 * active side when the OTHER side's concerns dominate the library entry,
 * and the clause is in fact PRESENT.
 */
function isClauseFavorableForSide(
  entry: ClauseLibraryEntry,
  side: UserSide,
  isPresent: boolean,
): boolean {
  if (!isPresent) return false
  // PRICE_PROTECTION, AUDIT_RIGHTS, MFN, FORCE_MAJEURE, INDEMNIFICATION
  // — defensive clauses that mostly help the facility when present.
  const FACILITY_FAVORABLE: ClauseCategory[] = [
    "PRICE_PROTECTION",
    "AUDIT_RIGHTS",
    "MOST_FAVORED_NATION",
    "FORCE_MAJEURE",
    "INDEMNIFICATION",
    "DATA_AND_HIPAA",
    "ANTI_STEERING",
  ]
  // EXCLUSIVITY, MINIMUM_COMMITMENT, AUTO_RENEWAL — vendor-favorable when present.
  const VENDOR_FAVORABLE: ClauseCategory[] = [
    "EXCLUSIVITY",
    "MINIMUM_COMMITMENT",
    "AUTO_RENEWAL",
  ]
  if (side === "FACILITY") {
    if (FACILITY_FAVORABLE.includes(entry.category)) return true
    if (VENDOR_FAVORABLE.includes(entry.category)) return false
  } else {
    if (VENDOR_FAVORABLE.includes(entry.category)) return true
    if (FACILITY_FAVORABLE.includes(entry.category)) return false
  }
  return false
}

/** Pick side-appropriate concerns + suggestions for a clause. */
function buildAssessment(
  clause: ContractClause,
  entry: ClauseLibraryEntry,
  side: UserSide,
  isPresent: boolean,
): ClauseRiskAssessment {
  const concerns =
    side === "FACILITY" ? entry.facilityConcerns : entry.vendorConcerns
  const suggestions =
    side === "FACILITY" ? entry.facilitySuggestions : entry.vendorSuggestions
  const riskLevel = clause.detectedRiskLevel ?? entry.baseRisk
  return {
    category: entry.category,
    riskLevel,
    isPresent,
    concerns,
    suggestions,
    regulatoryImplication: entry.regulatoryImplication,
    isFavorable: isClauseFavorableForSide(entry, side, isPresent),
  }
}

/** Bump risk one notch higher (used for side-specific aggravators). */
function bumpRisk(level: RiskLevel): RiskLevel {
  if (level === "LOW") return "MEDIUM"
  if (level === "MEDIUM") return "HIGH"
  if (level === "HIGH") return "CRITICAL"
  return "CRITICAL"
}

// ---------------------------------------------------------------------------
// analyzePDFContract — main entrypoint
// ---------------------------------------------------------------------------

/**
 * Run the canonical analyzer against a list of extracted ContractClause
 * objects. The caller is responsible for the upstream extraction (regex,
 * Claude, or manual entry) — this function consumes structured input.
 */
export function analyzePDFContract(
  clauses: ContractClause[],
  side: UserSide,
  contractVariant: ContractVariant,
  contractName: string,
): PDFContractAnalysisResult {
  const requiredCategories = REQUIRED_CLAUSES[contractVariant] ?? []
  const presentCategories = new Set<ClauseCategory>(
    clauses.map((c) => c.category),
  )

  // 1. Per-clause assessments (one per CLAUSE the caller supplied)
  const clauseAssessments: ClauseRiskAssessment[] = clauses.map((clause) => {
    const entry = CLAUSE_RISK_LIBRARY[clause.category]
    if (!entry) {
      // Unknown category — emit a low-risk OTHER assessment so we don't drop input.
      return buildAssessment(
        clause,
        CLAUSE_RISK_LIBRARY.OTHER,
        side,
        true,
      )
    }
    const assessment = buildAssessment(clause, entry, side, true)
    // Side-specific aggravators based on Charles's brief:
    //   - facility side flags AUTO_RENEWAL as a higher concern than baseline
    //   - vendor side flags MFN as a higher concern (margin compression)
    if (side === "FACILITY" && clause.category === "AUTO_RENEWAL") {
      assessment.riskLevel = bumpRisk(assessment.riskLevel)
    }
    if (side === "VENDOR" && clause.category === "MOST_FAVORED_NATION") {
      assessment.riskLevel = bumpRisk(assessment.riskLevel)
    }
    return assessment
  })

  // 2. Missing clauses — required-by-variant minus present
  const missingClauses: MissingClauseAlert[] = []
  for (const required of requiredCategories) {
    if (presentCategories.has(required)) continue
    const suggestion = MISSING_CLAUSE_SUGGESTIONS[required]
    if (suggestion) {
      missingClauses.push(suggestion)
    } else {
      // Synthesize a generic missing-clause alert from the library entry.
      const entry = CLAUSE_RISK_LIBRARY[required]
      missingClauses.push({
        category: required,
        riskLevel: entry.baseRisk,
        reason: `Required for ${contractVariant} contracts but not present.`,
        recommendedLanguage:
          "Add a standard clause covering this category; consult counsel for specific language.",
      })
    }
  }

  // 3. Cross-clause / regulatory checks → CriticalFlags
  const criticalFlags: CriticalFlag[] = []
  const isCapitalOrTieIn =
    contractVariant === "CAPITAL_PURCHASE" ||
    contractVariant === "CAPITAL_LEASE" ||
    contractVariant === "CAPITAL_TIEIN" ||
    contractVariant === "USAGE_TIEIN"

  if (isCapitalOrTieIn && !presentCategories.has("STARK_LAW")) {
    criticalFlags.push({
      category: "STARK_LAW",
      riskLevel: "CRITICAL",
      message:
        "Capital / tie-in arrangement without an identified Stark Law exception. Strict-liability statute — addressing this is non-negotiable.",
      regulatoryImplication:
        CLAUSE_RISK_LIBRARY.STARK_LAW.regulatoryImplication,
    })
  }
  if (
    contractVariant !== "PRICING_ONLY" &&
    contractVariant !== "GPO" &&
    !presentCategories.has("ANTI_KICKBACK")
  ) {
    criticalFlags.push({
      category: "ANTI_KICKBACK",
      riskLevel: "CRITICAL",
      message:
        "No Anti-Kickback Statute representation. Rebate or in-kind structures must fit a Safe Harbor.",
      regulatoryImplication:
        CLAUSE_RISK_LIBRARY.ANTI_KICKBACK.regulatoryImplication,
    })
  }
  if (side === "FACILITY" && presentCategories.has("ANTI_STEERING")) {
    criticalFlags.push({
      category: "ANTI_STEERING",
      riskLevel: "HIGH",
      message:
        "Anti-steering clause present — review for antitrust and patient-choice impact.",
      regulatoryImplication:
        CLAUSE_RISK_LIBRARY.ANTI_STEERING.regulatoryImplication,
    })
  }
  if (side === "FACILITY" && presentCategories.has("AUTO_RENEWAL")) {
    criticalFlags.push({
      category: "AUTO_RENEWAL",
      riskLevel: "HIGH",
      message:
        "Auto-renewal clause present — confirm non-renewal notice window is operationally feasible.",
    })
  }
  if (
    side === "FACILITY" &&
    !presentCategories.has("PRICE_PROTECTION") &&
    contractVariant !== "PRICING_ONLY"
  ) {
    criticalFlags.push({
      category: "PRICE_PROTECTION",
      riskLevel: "HIGH",
      message:
        "No price-protection clause — vendor may raise unit prices mid-term and erode rebate value.",
    })
  }
  if (side === "VENDOR" && presentCategories.has("MOST_FAVORED_NATION")) {
    criticalFlags.push({
      category: "MOST_FAVORED_NATION",
      riskLevel: "HIGH",
      message:
        "MFN obligation present — review scope, comparable-customer definition, and audit cadence.",
      regulatoryImplication:
        CLAUSE_RISK_LIBRARY.MOST_FAVORED_NATION.regulatoryImplication,
    })
  }
  if (
    side === "FACILITY" &&
    !presentCategories.has("DATA_AND_HIPAA") &&
    (contractVariant === "SERVICE_FULL" || contractVariant === "SERVICE_MAINTENANCE")
  ) {
    criticalFlags.push({
      category: "DATA_AND_HIPAA",
      riskLevel: "CRITICAL",
      message:
        "Service contract without HIPAA / data-rights clause. Where PHI is in scope, BAA is mandatory.",
      regulatoryImplication: CLAUSE_RISK_LIBRARY.DATA_AND_HIPAA.regulatoryImplication,
    })
  }

  // 4. Aggregate score (0-100) — sum of assessment + missing + flag weights
  let scoreSum = 0
  for (const a of clauseAssessments) {
    if (!a.isFavorable) {
      scoreSum += RISK_WEIGHTS[a.riskLevel]
    }
  }
  for (const m of missingClauses) {
    scoreSum += RISK_WEIGHTS[m.riskLevel]
  }
  for (const f of criticalFlags) {
    scoreSum += RISK_WEIGHTS[f.riskLevel]
  }
  const overallRiskScore = Math.min(100, scoreSum)
  const overallRiskLevel = scoreToOverallRiskLevel(overallRiskScore)

  // 5. Favorable terms — present clauses where the active side benefits
  const favorableTerms = clauseAssessments
    .filter((a) => a.isFavorable)
    .map((a) => a.category)

  // 6. Negotiation priorities — sort by risk weight, deduped, top 5
  const priorityWithRank: Array<{ category: ClauseCategory; weight: number }> =
    []
  for (const f of criticalFlags) {
    priorityWithRank.push({
      category: f.category,
      weight: RISK_WEIGHTS[f.riskLevel] + 100, // bias flags above plain assessments
    })
  }
  for (const m of missingClauses) {
    priorityWithRank.push({
      category: m.category,
      weight: RISK_WEIGHTS[m.riskLevel] + 50,
    })
  }
  for (const a of clauseAssessments) {
    if (!a.isFavorable && a.riskLevel !== "LOW") {
      priorityWithRank.push({
        category: a.category,
        weight: RISK_WEIGHTS[a.riskLevel],
      })
    }
  }
  priorityWithRank.sort((a, b) => b.weight - a.weight)
  const seen = new Set<ClauseCategory>()
  const negotiationPriorities: ClauseCategory[] = []
  for (const p of priorityWithRank) {
    if (seen.has(p.category)) continue
    seen.add(p.category)
    negotiationPriorities.push(p.category)
    if (negotiationPriorities.length >= 5) break
  }

  // 7. Summary headline
  const summary =
    `${contractName} — overall risk ${overallRiskLevel} (${overallRiskScore}/100). ` +
    `${clauseAssessments.length} clause${clauseAssessments.length === 1 ? "" : "s"} reviewed, ` +
    `${missingClauses.length} required clause${missingClauses.length === 1 ? "" : "s"} missing, ` +
    `${criticalFlags.length} flag${criticalFlags.length === 1 ? "" : "s"}.`

  return {
    contractName,
    side,
    contractVariant,
    clauseAssessments,
    missingClauses,
    overallRiskScore,
    overallRiskLevel,
    criticalFlags,
    favorableTerms,
    negotiationPriorities,
    summary,
  }
}
