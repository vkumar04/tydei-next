"use client"

import type { ColumnDef } from "@tanstack/react-table"
import { formatCurrency, formatDate } from "@/lib/formatting"

export interface ContractPeriodRow {
  id: string
  periodStart: string
  periodEnd: string
  totalSpend: number
  totalVolume: number
  rebateEarned: number
  rebateCollected: number
  paymentExpected: number
  paymentActual: number
  tierAchieved: number | null
}

export function getReportColumns(reportType: string): ColumnDef<ContractPeriodRow>[] {
  const base: ColumnDef<ContractPeriodRow>[] = [
    {
      accessorKey: "periodStart",
      header: "Period Start",
      cell: ({ getValue }) => formatDate(getValue<string>()),
    },
    {
      accessorKey: "periodEnd",
      header: "Period End",
      cell: ({ getValue }) => formatDate(getValue<string>()),
    },
    {
      accessorKey: "totalSpend",
      header: "Spend",
      cell: ({ getValue }) => formatCurrency(getValue<number>()),
    },
  ]

  if (reportType === "usage" || reportType === "tie_in") {
    base.push({
      accessorKey: "totalVolume",
      header: "Volume",
    })
  }

  base.push(
    {
      accessorKey: "rebateEarned",
      header: "Rebate Earned",
      cell: ({ getValue }) => formatCurrency(getValue<number>()),
    },
    {
      accessorKey: "rebateCollected",
      header: "Rebate Collected",
      cell: ({ getValue }) => formatCurrency(getValue<number>()),
    },
    {
      accessorKey: "paymentExpected",
      header: "Payment Expected",
      cell: ({ getValue }) => formatCurrency(getValue<number>()),
    },
    {
      accessorKey: "paymentActual",
      header: "Payment Actual",
      cell: ({ getValue }) => formatCurrency(getValue<number>()),
    },
  )

  if (reportType !== "capital") {
    base.push({
      accessorKey: "tierAchieved",
      header: "Tier",
      cell: ({ getValue }) => getValue<number | null>() ?? "-",
    })
  }

  return base
}
