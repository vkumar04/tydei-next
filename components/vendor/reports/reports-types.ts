/**
 * Shared types for the vendor Reports hub.
 *
 * Reports are currently rendered from static v0 sample data. The
 * `ReportType` id strings double as the tab-key + recent-report
 * category key.
 */

import type { LucideIcon } from "lucide-react"

export type ReportTypeId =
  | "performance"
  | "rebates"
  | "spend"
  | "compliance"

export interface ReportType {
  id: ReportTypeId
  name: string
  description: string
  icon: LucideIcon
  frequency: string
}

export interface RecentReport {
  id: string
  name: string
  type: ReportTypeId | string
  date: string
  status: string
  size: string
}

export interface ReportsDateRange {
  from: string
  to: string
}
