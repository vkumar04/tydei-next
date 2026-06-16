/**
 * Shared types for the vendor Reports Hub UI.
 *
 * Mirrors the facility hub (`components/facility/reports/reports-types.ts`).
 * The date-range and tab-key vocabulary are identical and re-exported so
 * the shared presentational components (ReportPeriodTable / ReportTrendChart
 * / ReportContractHeader) work unchanged. The contract row carries
 * `facilityName` because a vendor's contracts span multiple facilities —
 * the selector shows which facility each contract belongs to (where the
 * facility hub instead shows the vendor).
 */
export type {
  ReportsDateRange,
  ReportTabKey,
} from "@/components/facility/reports/reports-types"

export interface VendorReportsContract {
  id: string
  name: string
  contractType: string
  status: string
  vendorId: string
  vendorName: string
  facilityId: string | null
  facilityName: string
}
