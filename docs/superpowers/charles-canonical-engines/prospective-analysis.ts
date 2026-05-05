/**
 * ============================================================
 * PROSPECTIVE CONTRACT ANALYSIS ENGINE
 * Healthcare Contract Management Platform
 *
 * Source: Charles Weidman <Charles@tydei.io>, sent via email 2026-04-18
 * (companion to the Unified Rebate Calculation Engine)
 *
 * This is the canonical SPEC — not necessarily what tydei implements today.
 * Use docs/superpowers/audits/2026-05-04-prospective-analysis-audit.md to
 * see the gap between this spec and the current implementation.
 * ============================================================
 *
 * Covers both sides of the contracting relationship:
 *
 * VENDOR SIDE
 *  - Internal benchmark data entry (proprietary)
 *  - Revenue modeling across all contract types
 *  - Pricing scenario modeling (floor, target, ceiling)
 *  - Tier structure optimization
 *  - Capital deal ROI and payback analysis
 *  - Market share strategy analysis
 *  - Competitive positioning
 *  - Contract language risk flags (vendor perspective)
 *  - COG-based utilization and penetration analysis
 *
 * FACILITY SIDE
 *  - National / regional benchmark data (public sources only)
 *  - Total cost of ownership (TCO) modeling
 *  - Rebate yield analysis across contract variants
 *  - Multi-vendor / multi-contract portfolio comparison
 *  - Capital equipment: lease vs buy vs tie-in analysis
 *  - Market share commitment risk assessment
 *  - Contract language risk flags (facility perspective)
 *  - COG-based spend pattern and savings opportunity analysis
 *  - Compliance cost modeling
 *
 * PDF CONTRACT ANALYSIS
 *  - Clause extraction and categorization
 *  - Risk scoring per clause
 *  - Side-specific language alerts
 *  - Missing clause detection
 *
 * PRICING FILE ANALYSIS
 *  - Line-level comparison vs benchmark
 *  - Off-contract spend identification
 *  - Savings opportunity quantification
 *
 * ============================================================
 *
 * Key exported functions:
 *   - analyzePricingFile(lines, side) → PricingFileAnalysisResult
 *   - analyzePDFContract(clauses, side, variant, name) → PDFContractAnalysisResult
 *   - analyzeVendorProspective(input) → VendorProspectiveResult
 *   - analyzeFacilityProspective(input) → FacilityProspectiveResult
 *   - analyzeCOGSpendPatterns(input) → COGSpendAnalysisResult
 *
 * Key shared types:
 *   - UserSide ('VENDOR' | 'FACILITY')
 *   - ContractVariant (13 variants: USAGE_*, CAPITAL_*, SERVICE_*, GPO, PRICING_ONLY)
 *   - BenchmarkSource (INTERNAL, NATIONAL_*, REGIONAL_*, GPO_CONTRACT, USER_ENTERED)
 *   - RiskLevel (LOW, MEDIUM, HIGH, CRITICAL)
 *   - CapitalStructure (OUTRIGHT_PURCHASE, OPERATING_LEASE, CAPITAL_LEASE, TIE_IN)
 *   - ClauseCategory (24 categories incl. PRICING, REBATE, AUTO_RENEWAL, MFN,
 *     EXCLUSIVITY, ANTI_STEERING, ANTI_KICKBACK, STARK_LAW, ...)
 *
 * Internal data structures:
 *   - CLAUSE_RISK_LIBRARY (per-clause vendor/facility concerns + suggestions)
 *   - REQUIRED_CLAUSES (per-variant required-clause map)
 *   - MISSING_CLAUSE_SUGGESTIONS (recommended language for missing clauses)
 *
 * Outputs include:
 *   - VendorProspectiveResult: scenarioResults, recommendedScenario,
 *     revenueAtRisk, penetrationAnalysis, capitalAnalysis, tierOptimization
 *   - FacilityProspectiveResult: tco, rebateYield, pricingAnalysis,
 *     vendorComparison, capitalAnalysis, commitmentRisk, recommendation
 *   - PDFContractAnalysisResult: clauseAssessments, missingClauses,
 *     overallRiskScore, criticalFlags, favorableTerms, negotiationPriorities
 *   - COGSpendAnalysisResult: spendByVendor, spendByCategory,
 *     offContractOpportunities, priceExceptions
 *
 * (Full implementation source omitted from this snapshot — refer to Charles's
 * email of 2026-04-18 for the full canonical reference. The full source is
 * ~1200 lines of TypeScript including the CLAUSE_RISK_LIBRARY tables.)
 */
