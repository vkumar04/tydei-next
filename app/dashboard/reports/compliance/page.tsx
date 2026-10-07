import { requireFacility } from "@/lib/actions/auth"
import { ComplianceReportClient } from "@/components/facility/reports/compliance-report-client"

/**
 * Per-purchase compliance audit (v0-port). Walks every COG record in
 * the selected window and emits a violations list per the v0 §5
 * 5-check audit (off-contract vendor, out-of-period, unapproved item,
 * price variance band).
 */
export default async function ComplianceReportPage() {
  const { facility } = await requireFacility()
  return <ComplianceReportClient facilityId={facility.id} />
}
