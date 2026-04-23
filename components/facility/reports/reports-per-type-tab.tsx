"use client"

import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { formatCurrency } from "@/lib/formatting"
import { queryKeys } from "@/lib/query-keys"
import { getReportData } from "@/lib/actions/reports"
import type { ReportsDateRange, ReportsContract } from "./reports-types"

/**
 * Generic per-contract-type tab. Fetches contract+period data via
 * the existing `getReportData` action and renders a type-specific
 * column set.
 *
 * Reference: docs/superpowers/specs/2026-04-18-reports-hub-rewrite.md §4.3
 */

export type PerTypeTab =
  | "usage"
  | "capital"
  | "service"
  | "tie_in"
  | "grouped"
  | "pricing"

export interface ReportsPerTypeTabProps {
  tab: PerTypeTab
  facilityId: string
  dateRange: ReportsDateRange
  selectedContract: ReportsContract | null
}

// The legacy `getReportData` action doesn't have a dedicated `pricing_only`
// bucket — the closest fit is `usage` since pricing-only contracts share
// the same period shape.
const TAB_TO_SERVER_TYPE: Record<
  PerTypeTab,
  "usage" | "service" | "capital" | "tie_in" | "grouped"
> = {
  usage: "usage",
  capital: "capital",
  service: "service",
  tie_in: "tie_in",
  grouped: "grouped",
  pricing: "usage",
}

const TAB_TITLE: Record<PerTypeTab, string> = {
  usage: "Usage Contract Performance",
  capital: "Capital Contract Performance",
  service: "Service Contract Performance",
  tie_in: "Tie-In Contract Performance",
  grouped: "Grouped Contract Performance",
  pricing: "Pricing-Only Contract Performance",
}

interface PeriodRow {
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

interface ContractRow {
  id: string
  name: string
  vendor: string
  vendorId: string
  contractType: string
  totalValue: number
  // Charles 2026-04-23 audit — canonical Rebate-table totals computed
  // server-side in getReportData via sumEarnedRebatesLifetime /
  // sumCollectedRebates. Tabs display these so they reconcile with
  // Contract Detail header + Dashboard KPIs.
  rebateEarnedCanonical: number
  rebateCollectedCanonical: number
  periods: PeriodRow[]
}

interface ContractAggregate {
  id: string
  name: string
  vendor: string
  totalValue: number
  spend: number
  volume: number
  rebateEarned: number
  rebateCollected: number
  paymentExpected: number
  paymentActual: number
  periodCount: number
}

export function ReportsPerTypeTab({
  tab,
  facilityId,
  dateRange,
  selectedContract,
}: ReportsPerTypeTabProps) {
  const serverType = TAB_TO_SERVER_TYPE[tab]

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.reports.data(facilityId, serverType, dateRange),
    queryFn: () =>
      getReportData({
        facilityId,
        reportType: serverType,
        dateFrom: dateRange.from,
        dateTo: dateRange.to,
      }),
  })

  // Narrow contracts to the currently selected one (when any).
  const contracts = useMemo<ContractRow[]>(() => {
    const rows = (data?.contracts ?? []) as ContractRow[]
    if (!selectedContract) return rows
    return rows.filter((c) => c.id === selectedContract.id)
  }, [data, selectedContract])

  const aggregates = useMemo<ContractAggregate[]>(() => {
    return contracts.map((c) => {
      const periods = c.periods
      return {
        id: c.id,
        name: c.name,
        vendor: c.vendor,
        totalValue: c.totalValue,
        spend: periods.reduce((s, p) => s + p.totalSpend, 0),
        volume: periods.reduce((s, p) => s + p.totalVolume, 0),
        // Charles 2026-04-23 audit — canonical rebate totals come from
        // the Rebate table via sumEarnedRebatesLifetime /
        // sumCollectedRebates, routed through the server
        // (`rebateEarnedCanonical` / `rebateCollectedCanonical` on
        // getReportData). Reducing over ContractPeriod.rebateEarned/
        // Collected drifted from the canonical helpers the rest of
        // the app uses.
        rebateEarned: c.rebateEarnedCanonical,
        rebateCollected: c.rebateCollectedCanonical,
        paymentExpected: periods.reduce((s, p) => s + p.paymentExpected, 0),
        paymentActual: periods.reduce((s, p) => s + p.paymentActual, 0),
        periodCount: periods.length,
      }
    })
  }, [contracts])

  if (isLoading) {
    return <Skeleton className="h-[420px] rounded-xl" />
  }

  if (aggregates.length === 0) {
    return (
      <Card>
        <CardContent className="py-16 text-center text-sm text-muted-foreground">
          No contracts in this category for the selected range.
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>{TAB_TITLE[tab]}</CardTitle>
            <CardDescription>
              {dateRange.from} — {dateRange.to}
            </CardDescription>
          </div>
          <Badge variant="outline">{aggregates.length} contracts</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Contract</th>
                <th className="px-4 py-3 text-left font-medium">Vendor</th>
                {renderHeaders(tab)}
              </tr>
            </thead>
            <tbody>
              {aggregates.map((row) => (
                <tr key={row.id} className="border-t">
                  <td className="px-4 py-3 font-medium">{row.name}</td>
                  <td className="px-4 py-3">{row.vendor}</td>
                  {renderCells(tab, row)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}

function renderHeaders(tab: PerTypeTab) {
  switch (tab) {
    case "usage":
      return (
        <>
          <th className="px-4 py-3 text-right font-medium">Spend</th>
          <th className="px-4 py-3 text-right font-medium">Volume</th>
          <th className="px-4 py-3 text-right font-medium">Rebate Earned</th>
          <th className="px-4 py-3 text-right font-medium">
            Rebate Collected
          </th>
          <th className="px-4 py-3 text-right font-medium">Uncollected</th>
        </>
      )
    case "capital":
      return (
        <>
          <th className="px-4 py-3 text-right font-medium">Contract Value</th>
          <th className="px-4 py-3 text-right font-medium">Payment Expected</th>
          <th className="px-4 py-3 text-right font-medium">Payment Actual</th>
          <th className="px-4 py-3 text-right font-medium">Variance</th>
        </>
      )
    case "service":
      return (
        <>
          <th className="px-4 py-3 text-right font-medium">Payment Expected</th>
          <th className="px-4 py-3 text-right font-medium">Payment Actual</th>
          <th className="px-4 py-3 text-right font-medium">Variance</th>
        </>
      )
    case "tie_in":
      return (
        <>
          <th className="px-4 py-3 text-right font-medium">Spend</th>
          <th className="px-4 py-3 text-right font-medium">Volume</th>
          <th className="px-4 py-3 text-right font-medium">Rebate Earned</th>
          <th className="px-4 py-3 text-right font-medium">Payment Actual</th>
        </>
      )
    case "grouped":
      return (
        <>
          <th className="px-4 py-3 text-right font-medium">Periods</th>
          <th className="px-4 py-3 text-right font-medium">Total Spend</th>
          <th className="px-4 py-3 text-right font-medium">Rebate Earned</th>
        </>
      )
    case "pricing":
      return (
        <>
          <th className="px-4 py-3 text-right font-medium">Spend</th>
          <th className="px-4 py-3 text-right font-medium">Contract Value</th>
          <th className="px-4 py-3 text-right font-medium">Variance</th>
        </>
      )
  }
}

function renderCells(tab: PerTypeTab, row: ContractAggregate) {
  switch (tab) {
    case "usage": {
      const uncollected = row.rebateEarned - row.rebateCollected
      return (
        <>
          <td className="px-4 py-3 text-right">{formatCurrency(row.spend)}</td>
          <td className="px-4 py-3 text-right">
            {row.volume.toLocaleString()}
          </td>
          <td className="px-4 py-3 text-right">
            {formatCurrency(row.rebateEarned)}
          </td>
          <td className="px-4 py-3 text-right">
            {formatCurrency(row.rebateCollected)}
          </td>
          <td className="px-4 py-3 text-right">
            {formatCurrency(uncollected)}
          </td>
        </>
      )
    }
    case "capital": {
      const variance = row.paymentActual - row.paymentExpected
      return (
        <>
          <td className="px-4 py-3 text-right">
            {formatCurrency(row.totalValue)}
          </td>
          <td className="px-4 py-3 text-right">
            {formatCurrency(row.paymentExpected)}
          </td>
          <td className="px-4 py-3 text-right">
            {formatCurrency(row.paymentActual)}
          </td>
          <td className="px-4 py-3 text-right">{formatCurrency(variance)}</td>
        </>
      )
    }
    case "service": {
      const variance = row.paymentActual - row.paymentExpected
      return (
        <>
          <td className="px-4 py-3 text-right">
            {formatCurrency(row.paymentExpected)}
          </td>
          <td className="px-4 py-3 text-right">
            {formatCurrency(row.paymentActual)}
          </td>
          <td className="px-4 py-3 text-right">{formatCurrency(variance)}</td>
        </>
      )
    }
    case "tie_in":
      return (
        <>
          <td className="px-4 py-3 text-right">{formatCurrency(row.spend)}</td>
          <td className="px-4 py-3 text-right">
            {row.volume.toLocaleString()}
          </td>
          <td className="px-4 py-3 text-right">
            {formatCurrency(row.rebateEarned)}
          </td>
          <td className="px-4 py-3 text-right">
            {formatCurrency(row.paymentActual)}
          </td>
        </>
      )
    case "grouped":
      return (
        <>
          <td className="px-4 py-3 text-right">{row.periodCount}</td>
          <td className="px-4 py-3 text-right">{formatCurrency(row.spend)}</td>
          <td className="px-4 py-3 text-right">
            {formatCurrency(row.rebateEarned)}
          </td>
        </>
      )
    case "pricing": {
      const variance = row.spend - row.totalValue
      return (
        <>
          <td className="px-4 py-3 text-right">{formatCurrency(row.spend)}</td>
          <td className="px-4 py-3 text-right">
            {formatCurrency(row.totalValue)}
          </td>
          <td className="px-4 py-3 text-right">{formatCurrency(variance)}</td>
        </>
      )
    }
  }
}
