import type { ContractPeriodRow } from "../report-columns"

/* ─── Shared Types ───────────────────────────────────────────── */

export interface ContractSummary {
  id: string
  name: string
  vendor: string
  contractType: string
  periods: ContractPeriodRow[]
  // Charles 2026-04-23 audit — canonical Rebate-table totals computed
  // server-side so Reports numbers reconcile with Contract Detail /
  // Dashboard. Optional for back-compat with older call sites.
  rebateEarnedCanonical?: number
  rebateCollectedCanonical?: number
}

export interface ReportData {
  contracts: ContractSummary[]
}

export interface DateRange {
  from: string
  to: string
}

export type ReportTab =
  | "usage"
  | "service"
  | "capital"
  | "tie_in"
  | "grouped"
  | "pricing_only"
  | "overview"
  | "calculations"

export type ScheduleReportType =
  | "contract_performance"
  | "rebate_summary"
  | "spend_analysis"
  | "market_share"
  | "case_costing"

export type ScheduleFrequency = "daily" | "weekly" | "monthly"

export interface NewScheduleState {
  reportType: ScheduleReportType
  frequency: ScheduleFrequency
  recipients: string[]
  recipientInput: string
  includeCharts: boolean
  includeLineItems: boolean
}

export interface ScheduleRecord {
  id: string
  reportType: string
  frequency: string
  emailRecipients: string[]
  isActive: boolean
  lastSentAt: string | null
  createdAt: string
}
