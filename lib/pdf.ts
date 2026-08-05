// Compat facade — lib/pdf.ts was decomposed into lib/pdf/ modules by report
// family (2026-08-05). Every importer keeps using `@/lib/pdf`; the generator
// implementations live in lib/pdf/*.
//
// All PDFs render server-side via these generators → /api/reports/pdf
// (CLAUDE.md hard rule): jspdf must never be imported from app/ or
// components/ — `grep -rl jspdf app components` must stay empty.

export { generateContractReport } from "./pdf/contract-report"
export {
  generateReportPerformancePDF,
  type ReportPerfType,
  type ReportPerformanceInput,
} from "./pdf/report-performance"
export {
  generateTableReportPDF,
  type TableReportInput,
} from "./pdf/table-report"
export { generateRebateReport } from "./pdf/rebate-report"
export { generateSurgeonScorecard } from "./pdf/surgeon-scorecard"
export {
  generateAnalysisReportPDF,
  type AnalysisReportAssumptions,
  type AnalysisReportPayload,
} from "./pdf/analysis-report"
export {
  generateOpportunityReportPDF,
  type OpportunityReportPayload,
} from "./pdf/opportunity-report"
