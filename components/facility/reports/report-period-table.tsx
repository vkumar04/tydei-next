"use client"

import { DataTable } from "@/components/shared/tables/data-table"
import { getReportColumns, type ContractPeriodRow } from "./report-columns"

interface ReportPeriodTableProps {
  periods: ContractPeriodRow[]
  reportType: string
}

export function ReportPeriodTable({ periods, reportType }: ReportPeriodTableProps) {
  const columns = getReportColumns(reportType)

  return (
    <DataTable
      columns={columns}
      data={periods}
      pagination
      pageSize={10}
    />
  )
}
