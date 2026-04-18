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

export interface ReportsContract {
  id: string
  name: string
  contractType: string
  status: string
  vendorId: string
  vendorName: string
}
