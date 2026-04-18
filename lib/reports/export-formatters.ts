/**
 * Per-report-type CSV row formatters.
 *
 * Each {@link ReportType} has a fixed column template defined in
 * {@link REPORT_COLUMN_TEMPLATES} (see `lib/ai/report-classifier.ts`).
 * The `to*CSV` helpers in this file project typed row objects onto
 * those canonical column headers, returning a flat string-only
 * `Record<string, string>` that drops directly into {@link toCSV}.
 *
 * Pure functions only — no I/O, no synthesis of unknown data.
 *
 * Formatting rules:
 *   - Dates:    YYYY-MM-DD (UTC calendar day)
 *   - Dollars:  "1234.56" (no $, no thousands separators — CSVs reparse better)
 *   - Percent:  "12.3"    (no % sign)
 *   - Null/undefined → ""
 */

import type { ReportType } from "@/lib/ai/report-classifier"

// ----- Row shapes --------------------------------------------------------

export interface ContractPerformanceRow {
  vendor: string
  contractId: string
  startDate: Date
  endDate: Date
  totalSpend: number
  rebateEarned: number
  compliancePercent: number
}

export interface SurgeonPerformanceRow {
  surgeon: string
  specialty: string
  totalCases: number
  avgCaseCost: number
  contractCompliance: number
  rebateContribution: number
  costEfficiency: number
}

export interface RebateAnalysisRow {
  vendor: string
  contract: string
  currentTier: string
  nextTier: string | null
  currentSpend: number
  spendToNextTier: number | null
  potentialAdditionalRebate: number | null
}

export interface InvoiceDiscrepancyRow {
  invoiceNumber: string
  vendor: string
  invoiceDate: Date
  invoicedAmount: number
  contractAmount: number
  variance: number
  status: string
}

export interface CustomReportRow {
  category: string
  metric: string
  value: string | number
  change: string
  status: string
}

// ----- Primitive formatters ---------------------------------------------

/** Format a Date as YYYY-MM-DD (UTC) for CSV export. */
export function formatExportDate(d: Date): string {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return ""
  return d.toISOString().slice(0, 10)
}

/** Format dollars as "1234.56" (no $ or commas — CSVs reparse better). */
export function formatExportDollars(n: number): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return ""
  return n.toFixed(2)
}

/** Format percent as "12.3" (no % sign). */
export function formatExportPercent(n: number): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return ""
  return n.toFixed(1)
}

// ----- Typed-row → flat CSV record --------------------------------------

export function toContractPerformanceCSV(
  row: ContractPerformanceRow,
): Record<string, string> {
  return {
    Vendor: row.vendor,
    "Contract ID": row.contractId,
    "Start Date": formatExportDate(row.startDate),
    "End Date": formatExportDate(row.endDate),
    "Total Spend": formatExportDollars(row.totalSpend),
    "Rebate Earned": formatExportDollars(row.rebateEarned),
    "Compliance %": formatExportPercent(row.compliancePercent),
  }
}

export function toSurgeonPerformanceCSV(
  row: SurgeonPerformanceRow,
): Record<string, string> {
  return {
    Surgeon: row.surgeon,
    Specialty: row.specialty,
    "Total Cases": String(row.totalCases),
    "Avg Case Cost": formatExportDollars(row.avgCaseCost),
    "Contract Compliance": formatExportPercent(row.contractCompliance),
    "Rebate Contribution": formatExportDollars(row.rebateContribution),
    "Cost Efficiency": formatExportPercent(row.costEfficiency),
  }
}

export function toRebateAnalysisCSV(
  row: RebateAnalysisRow,
): Record<string, string> {
  return {
    Vendor: row.vendor,
    Contract: row.contract,
    "Current Tier": row.currentTier,
    "Next Tier": row.nextTier ?? "",
    "Current Spend": formatExportDollars(row.currentSpend),
    "Spend to Next Tier":
      row.spendToNextTier === null
        ? ""
        : formatExportDollars(row.spendToNextTier),
    "Potential Additional Rebate":
      row.potentialAdditionalRebate === null
        ? ""
        : formatExportDollars(row.potentialAdditionalRebate),
  }
}

export function toInvoiceDiscrepancyCSV(
  row: InvoiceDiscrepancyRow,
): Record<string, string> {
  return {
    "Invoice #": row.invoiceNumber,
    Vendor: row.vendor,
    "Invoice Date": formatExportDate(row.invoiceDate),
    "Invoiced Amount": formatExportDollars(row.invoicedAmount),
    "Contract Amount": formatExportDollars(row.contractAmount),
    Variance: formatExportDollars(row.variance),
    Status: row.status,
  }
}

export function toCustomReportCSV(
  row: CustomReportRow,
): Record<string, string> {
  return {
    Category: row.category,
    Metric: row.metric,
    Value: typeof row.value === "number" ? String(row.value) : row.value,
    Change: row.change,
    Status: row.status,
  }
}

/**
 * Re-export `ReportType` for convenience so callers that only import
 * this module can still discriminate on type.
 */
export type { ReportType }
