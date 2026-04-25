/**
 * Shared types for the Reports Hub UI.
 *
 * Reference: docs/superpowers/specs/2026-04-18-reports-hub-rewrite.md §4.1
 */

export interface ReportsDateRange {
  from: string
  to: string
}

export type ReportTabKey =
  | "overview"
  | "usage"
  | "capital"
  | "service"
  | "tie_in"
  | "grouped"
  | "pricing"
  | "calculations"
  // Charles 2026-04-25 (audit follow-up): rebate-type breakdown so
  // a facility can answer "what % of my earned came from spend
  // rebates vs volume vs PO vs threshold?" without exporting raw
  // Rebate rows. The contract-type tabs above don't reveal this
  // because one contract can mix term types.
  | "by_rebate_type"

export interface ReportsContract {
  id: string
  name: string
  contractType: string
  status: string
  vendorId: string
  vendorName: string
}
