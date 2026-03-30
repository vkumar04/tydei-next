"use client"

import { formatCurrency } from "@/lib/formatting"
import type { ContractPeriodRow } from "./report-columns"

interface ReportPeriodTableProps {
  periods: ContractPeriodRow[]
  reportType: string
}

export function ReportPeriodTable({ periods, reportType }: ReportPeriodTableProps) {
  const isUsage = reportType === "usage"
  const isService = reportType === "service" || reportType === "capital"
  const isTieIn = reportType === "tie_in"

  const totalSpend = periods.reduce((s, p) => s + p.totalSpend, 0)
  const totalRebateEarned = periods.reduce((s, p) => s + p.rebateEarned, 0)
  const totalRebateCollected = periods.reduce((s, p) => s + p.rebateCollected, 0)
  const totalPaymentExpected = periods.reduce((s, p) => s + p.paymentExpected, 0)
  const totalPaymentActual = periods.reduce((s, p) => s + p.paymentActual, 0)

  return (
    <div className="rounded-lg border overflow-hidden mb-6">
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr>
            <th className="px-4 py-3 text-left font-medium">#</th>
            <th className="px-4 py-3 text-left font-medium">Period</th>
            {isUsage && (
              <>
                <th className="px-4 py-3 text-right font-medium">Spend</th>
                <th className="px-4 py-3 text-right font-medium">Volume</th>
                <th className="px-4 py-3 text-right font-medium">Rebate (Earned)</th>
                <th className="px-4 py-3 text-right font-medium">Rebate (Collected)</th>
              </>
            )}
            {isService && (
              <>
                <th className="px-4 py-3 text-right font-medium">Payment (Expected)</th>
                <th className="px-4 py-3 text-right font-medium">Balance (Expected)</th>
                <th className="px-4 py-3 text-right font-medium">Payments (Actual)</th>
                <th className="px-4 py-3 text-right font-medium">Balance (Actual)</th>
              </>
            )}
            {isTieIn && (
              <>
                <th className="px-3 py-3 text-right font-medium">Spend Target</th>
                <th className="px-3 py-3 text-right font-medium">Spend Actual</th>
                <th className="px-3 py-3 text-right font-medium">Vol. Target</th>
                <th className="px-3 py-3 text-right font-medium">Vol. Actual</th>
                <th className="px-3 py-3 text-right font-medium">Rebate Earned</th>
                <th className="px-3 py-3 text-right font-medium">Rebate Collected</th>
                <th className="px-3 py-3 text-right font-medium">Payment Actual</th>
                <th className="px-3 py-3 text-right font-medium">Balance</th>
              </>
            )}
            {reportType === "grouped" && (
              <>
                <th className="px-4 py-3 text-right font-medium">Spend</th>
                <th className="px-4 py-3 text-right font-medium">Rebate Earned</th>
                <th className="px-4 py-3 text-right font-medium">Rebate Collected</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {periods.map((row, index) => (
            <tr key={row.id} className="border-t">
              <td className="px-4 py-3">{index + 1}</td>
              <td className="px-4 py-3 whitespace-nowrap">
                {row.periodStart.split("T")[0]} &ndash; {row.periodEnd.split("T")[0]}
              </td>
              {isUsage && (
                <>
                  <td className="px-4 py-3 text-right">{formatCurrency(row.totalSpend)}</td>
                  <td className="px-4 py-3 text-right">{row.totalVolume}</td>
                  <td className="px-4 py-3 text-right">{formatCurrency(row.rebateEarned)}</td>
                  <td className="px-4 py-3 text-right">{formatCurrency(row.rebateCollected)}</td>
                </>
              )}
              {isService && (
                <>
                  <td className="px-4 py-3 text-right">{formatCurrency(row.paymentExpected)}</td>
                  <td className="px-4 py-3 text-right">{formatCurrency(row.rebateCollected)}</td>
                  <td className="px-4 py-3 text-right">{formatCurrency(row.paymentActual)}</td>
                  <td className="px-4 py-3 text-right">{formatCurrency(row.rebateEarned)}</td>
                </>
              )}
              {isTieIn && (
                <>
                  <td className="px-3 py-3 text-right">{formatCurrency(row.totalSpend)}</td>
                  <td className="px-3 py-3 text-right">{formatCurrency(row.paymentActual)}</td>
                  <td className="px-3 py-3 text-right">{row.totalVolume}</td>
                  <td className="px-3 py-3 text-right">{row.totalVolume}</td>
                  <td className="px-3 py-3 text-right">{formatCurrency(row.rebateEarned)}</td>
                  <td className="px-3 py-3 text-right">{formatCurrency(row.rebateCollected)}</td>
                  <td className="px-3 py-3 text-right">{formatCurrency(row.paymentActual)}</td>
                  <td className="px-3 py-3 text-right">{formatCurrency(row.paymentExpected)}</td>
                </>
              )}
              {reportType === "grouped" && (
                <>
                  <td className="px-4 py-3 text-right">{formatCurrency(row.totalSpend)}</td>
                  <td className="px-4 py-3 text-right">{formatCurrency(row.rebateEarned)}</td>
                  <td className="px-4 py-3 text-right">{formatCurrency(row.rebateCollected)}</td>
                </>
              )}
            </tr>
          ))}
        </tbody>
        <tfoot className="bg-primary text-primary-foreground">
          <tr>
            <td colSpan={2} className="px-4 py-3 font-medium">Total (to date)</td>
            {isUsage && (
              <>
                <td className="px-4 py-3 text-right font-medium">{formatCurrency(totalSpend)}</td>
                <td className="px-4 py-3 text-right font-medium">-</td>
                <td className="px-4 py-3 text-right font-medium">{formatCurrency(totalRebateEarned)}</td>
                <td className="px-4 py-3 text-right font-medium">{formatCurrency(totalRebateCollected)}</td>
              </>
            )}
            {isService && (
              <>
                <td className="px-4 py-3 text-right font-medium">{formatCurrency(totalPaymentExpected)}</td>
                <td className="px-4 py-3 text-right font-medium">{formatCurrency(totalRebateCollected)}</td>
                <td className="px-4 py-3 text-right font-medium">{formatCurrency(totalPaymentActual)}</td>
                <td className="px-4 py-3 text-right font-medium">{formatCurrency(totalRebateEarned)}</td>
              </>
            )}
            {isTieIn && (
              <>
                <td className="px-3 py-3 text-right font-medium">{formatCurrency(totalSpend)}</td>
                <td colSpan={2} className="px-3 py-3 text-right font-medium">-</td>
                <td className="px-3 py-3 text-right font-medium">{formatCurrency(totalSpend)}</td>
                <td className="px-3 py-3 text-right font-medium">{formatCurrency(totalRebateEarned)}</td>
                <td className="px-3 py-3 text-right font-medium">{formatCurrency(totalRebateCollected)}</td>
                <td className="px-3 py-3 text-right font-medium">{formatCurrency(totalPaymentActual)}</td>
                <td className="px-3 py-3"></td>
              </>
            )}
            {reportType === "grouped" && (
              <>
                <td className="px-4 py-3 text-right font-medium">{formatCurrency(totalSpend)}</td>
                <td className="px-4 py-3 text-right font-medium">{formatCurrency(totalRebateEarned)}</td>
                <td className="px-4 py-3 text-right font-medium">{formatCurrency(totalRebateCollected)}</td>
              </>
            )}
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
