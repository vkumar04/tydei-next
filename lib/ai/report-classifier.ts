/**
 * Report Generator prompt classifier.
 *
 * Per spec §4.4 (Report Generator prompt-routing table), every incoming
 * prompt is deterministically classified into one of five canonical
 * report types BEFORE the Claude call. This lets the caller pin a
 * column template per report type, which keeps CSV output shape
 * stable regardless of what the LLM returns.
 *
 * Classification is pure and synchronous — no network, no randomness.
 * The rules live in `classifyReportPrompt` and are evaluated in
 * strict priority order (first match wins).
 */

export type ReportType =
  | "contract_performance"
  | "surgeon_performance"
  | "rebate_analysis"
  | "invoice_discrepancy"
  | "custom"

/**
 * Canonical column templates per report type. These are the columns
 * the Report Generator will render into its CSV export regardless of
 * what the Claude response contains — we project the response onto
 * this fixed shape so downloads are predictable.
 */
export const REPORT_COLUMN_TEMPLATES: Record<ReportType, string[]> = {
  contract_performance: [
    "Vendor",
    "Contract ID",
    "Start Date",
    "End Date",
    "Total Spend",
    "Rebate Earned",
    "Compliance %",
  ],
  surgeon_performance: [
    "Surgeon",
    "Specialty",
    "Total Cases",
    "Avg Case Cost",
    "Contract Compliance",
    "Rebate Contribution",
    "Cost Efficiency",
  ],
  rebate_analysis: [
    "Vendor",
    "Contract",
    "Current Tier",
    "Next Tier",
    "Current Spend",
    "Spend to Next Tier",
    "Potential Additional Rebate",
  ],
  invoice_discrepancy: [
    "Invoice #",
    "Vendor",
    "Invoice Date",
    "Invoiced Amount",
    "Contract Amount",
    "Variance",
    "Status",
  ],
  custom: ["Category", "Metric", "Value", "Change", "Status"],
}

/**
 * Deterministically classify a free-text report prompt into one of
 * the five canonical report types.
 *
 * Rules (first match wins):
 *   1. "contract" or "vendor"                       → contract_performance
 *   2. "surgeon" or "physician"                     → surgeon_performance
 *   3. "rebate" or "tier"                           → rebate_analysis
 *   4. "invoice" or "discrepancy" or "variance"     → invoice_discrepancy
 *   5. fallback                                      → custom
 *
 * Matching is case-insensitive, substring match (no word boundary
 * required) so tokens like "contractual" still match "contract".
 */
export function classifyReportPrompt(prompt: string): ReportType {
  const p = (prompt ?? "").toLowerCase()

  if (p.includes("contract") || p.includes("vendor")) {
    return "contract_performance"
  }
  if (p.includes("surgeon") || p.includes("physician")) {
    return "surgeon_performance"
  }
  if (p.includes("rebate") || p.includes("tier")) {
    return "rebate_analysis"
  }
  if (
    p.includes("invoice") ||
    p.includes("discrepancy") ||
    p.includes("variance")
  ) {
    return "invoice_discrepancy"
  }
  return "custom"
}

/**
 * Build the canonical CSV filename for a Report Generator export.
 *
 * Format: `${title_with_underscores}_${YYYY-MM-DD}.csv`
 *
 * - Replaces any run of whitespace with a single underscore.
 * - Strips filesystem-hostile characters (`/\:*?"<>|`) so the
 *   filename is safe across macOS / Linux / Windows downloads.
 * - Uses ISO date slice(0, 10) (UTC calendar day) for the suffix.
 * - Defaults to "now" when no date is provided.
 */
export function buildCSVFilename(title: string, date?: Date): string {
  const safeTitle = (title ?? "")
    .replace(/[/\\:*?"<>|]/g, "")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")

  const d = date ?? new Date()
  const iso = d.toISOString().slice(0, 10)

  return `${safeTitle}_${iso}.csv`
}
