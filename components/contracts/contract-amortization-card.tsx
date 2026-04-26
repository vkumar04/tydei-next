"use client"

/**
 * Tie-In capital amortization card.
 *
 * Wave A (2026-04-19 tie-in parity): surfaces the numbers the engine
 * in lib/rebates/engine/amortization.ts has been producing since R3.8
 * but which no UI has ever rendered. Shows:
 *   1. A 3-tile summary strip — remaining balance, principal paid to
 *      date, and a linear-projection payoff date.
 *   2. A full schedule table (period #, period date, opening balance,
 *      interest charge, principal due, amortization due, closing
 *      balance).
 *
 * Data comes from getContractCapitalSchedule (lib/actions/contracts/
 * tie-in.ts), which prefers persisted ContractAmortizationSchedule
 * rows and falls back to an on-the-fly engine build when none exist.
 * The engine is untouched — this component is pure wiring.
 */

import { useQuery } from "@tanstack/react-query"
import { HelpCircle } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { formatCurrency, formatCalendarDate } from "@/lib/formatting"
import {
  getContractCapitalSchedule,
  type ContractCapitalScheduleResult,
} from "@/lib/actions/contracts/tie-in"
import { Badge } from "@/components/ui/badge"
import { computeMinAnnualShortfall } from "@/lib/contracts/min-annual-shortfall"
import { computeCapitalRetirementNeeded } from "@/lib/contracts/capital-retirement-needed"

interface ContractAmortizationCardProps {
  contractId: string
  /**
   * Charles audit suggestion #3: optional fetcher so the vendor portal
   * can pass `getVendorContractCapitalSchedule` (vendor-scoped) and
   * the facility portal keeps the default. Same return shape.
   */
  fetcher?: (contractId: string) => Promise<ContractCapitalScheduleResult>
  /** Cache key suffix to keep facility/vendor caches separate. */
  scope?: "facility" | "vendor"
}

export function ContractAmortizationCard({
  contractId,
  fetcher = getContractCapitalSchedule,
  scope = "facility",
}: ContractAmortizationCardProps) {
  const { data, isLoading } = useQuery({
    queryKey: ["contract-capital-schedule", scope, contractId],
    queryFn: () => fetcher(contractId),
  })

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Capital Amortization</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-48 w-full" />
        </CardContent>
      </Card>
    )
  }

  if (!data || !data.hasSchedule || data.schedule.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Capital Amortization</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No amortization schedule yet — set capital cost, interest rate,
            and term months on a term to generate.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <span>Capital Amortization</span>
          <span className="text-xs font-normal text-muted-foreground">
            {formatCurrency(data.capitalCost)} @{" "}
            {(data.interestRate * 100).toFixed(2)}% over {data.termMonths} mo (
            {data.period})
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Charles audit suggestion #4 (v0-port): per-asset capital
            line items rendered v0-style above the aggregate schedule.
            When a contract finances multiple pieces of equipment, each
            shows description / item # / serial / financed amount /
            rate / term / cadence. Legacy single-item contracts show
            one synthetic row built from the contract-level fields and
            the section is hidden behind a smaller header (less visual
            weight when there's nothing to see beyond the summary). */}
        {data.capitalLineItems && data.capitalLineItems.length > 0 && (() => {
          const total = data.capitalLineItems.reduce(
            (acc, i) => acc + Math.max(0, i.contractTotal - i.initialSales),
            0,
          )
          return (
            <div className="space-y-2">
              <div className="flex items-baseline justify-between gap-2">
                <h4 className="text-sm font-medium">
                  Leased / Financed Items ({data.capitalLineItems.length})
                </h4>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {formatCurrency(total)} financed total
                </span>
              </div>
              {(
                <div className="overflow-hidden rounded-md border">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/40 text-[10px] uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium">Description</th>
                        <th className="px-3 py-2 text-left font-medium">Item / Serial</th>
                        <th className="px-3 py-2 text-right font-medium">Contract</th>
                        <th className="px-3 py-2 text-right font-medium">Financed</th>
                        <th className="px-3 py-2 text-right font-medium">Rate</th>
                        <th className="px-3 py-2 text-right font-medium">Term</th>
                        <th className="px-3 py-2 text-left font-medium">Schedule</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.capitalLineItems.map((item) => {
                        const financed = Math.max(
                          0,
                          item.contractTotal - item.initialSales,
                        )
                        return (
                          <tr key={item.id} className="border-t">
                            <td className="px-3 py-2 font-medium">
                              {item.description}
                            </td>
                            <td className="px-3 py-2 text-muted-foreground">
                              {item.itemNumber || item.serialNumber ? (
                                <div className="space-y-0.5">
                                  {item.itemNumber && <div>{item.itemNumber}</div>}
                                  {item.serialNumber && (
                                    <div className="text-[10px]">
                                      SN: {item.serialNumber}
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <span className="text-muted-foreground/60">—</span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {formatCurrency(item.contractTotal)}
                              {item.initialSales > 0 && (
                                <div className="text-[10px] text-muted-foreground">
                                  −{formatCurrency(item.initialSales)} down
                                </div>
                              )}
                            </td>
                            <td className="px-3 py-2 text-right font-medium tabular-nums">
                              {formatCurrency(financed)}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {(item.interestRate * 100).toFixed(2)}%
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {item.termMonths} mo
                            </td>
                            <td className="px-3 py-2 capitalize text-muted-foreground">
                              {item.paymentType} · {item.paymentCadence}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )
        })()}

        {/* ── Capital summary strip (A2) ───────────────────────────── */}
        <div className="grid gap-4 sm:grid-cols-3">
          <SummaryTile
            label="Remaining Balance"
            tooltip="Capital cost minus the rebate that has been collected and applied to the balance."
            value={formatCurrency(data.remainingBalance)}
          />
          <SummaryTile
            label="Paid To Date"
            tooltip="Collected rebate that has been applied to the capital balance. On tie-in contracts, 100% of collected rebate retires capital."
            value={formatCurrency(data.paidToDate)}
          />
          <SummaryTile
            label="Projected End-of-Term Balance"
            tooltip="Projected capital balance at the contract's scheduled end date given the trailing rebate-paydown velocity. $0 means the paydown is on track to retire the balance before the term ends."
            value={formatCurrency(data.projectedEndOfTermBalance ?? data.remainingBalance)}
          />
        </div>

        {/* ── Rebate applied + balance due (W1.Y-C, C3) ─────────────
            Charles iMessage 2026-04-20: "Maybe here it should show the
            rebate they earned and if there is a balance on what is due
            as well." Reads `rebateAppliedToCapital` from the canonical
            `sumRebateAppliedToCapital` helper (via getContractCapitalSchedule)
            so this row and the header "applied to capital" sublabel
            cannot drift. */}
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-md border bg-card p-3">
            <p className="text-xs text-muted-foreground">
              Rebates Applied (lifetime)
            </p>
            <p className="mt-1 text-xl font-semibold tabular-nums text-blue-600 dark:text-blue-400">
              {formatCurrency(data.rebateAppliedToCapital)}
            </p>
          </div>
          <div className="rounded-md border bg-card p-3">
            <p className="text-xs text-muted-foreground">Balance Due</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">
              {formatCurrency(
                Math.max(data.capitalCost - data.rebateAppliedToCapital, 0),
              )}
            </p>
          </div>
          <div className="rounded-md border bg-card p-3">
            <p className="text-xs text-muted-foreground">Capital Cost</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">
              {formatCurrency(data.capitalCost)}
            </p>
          </div>
        </div>

        {/* ── Minimum Annual Purchase + Annual Spend Needed (W1.Y-D) ──
            Charles iMessage 2026-04-20: "If there is a floor on this the
            math needs to run the rolling 12 so that it can see the rebate
            that is needed based on the terms to pay the Amortization off."
            Tie-in only — `minAnnualPurchase` stays reference-only on
            other contract types (see form help text in contract-terms-
            entry.tsx). Math is delegated to the canonical
            `computeMinAnnualShortfall` and `computeCapitalRetirementNeeded`
            reducers so this surface cannot drift from peer surfaces. */}
        {data.contractType === "tie_in" ? (
          <TieInMinPurchaseBlock data={data} />
        ) : null}

        {/* ── Schedule table (A1) ──────────────────────────────────── */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="py-2 pr-3 text-left font-medium">Period #</th>
                <th className="py-2 pr-3 text-left font-medium">Period Date</th>
                <th className="py-2 pr-3 text-right font-medium">
                  Opening Balance
                </th>
                <th className="py-2 pr-3 text-right font-medium">
                  Interest Charge
                </th>
                <th className="py-2 pr-3 text-right font-medium">
                  Principal Due
                </th>
                <th className="py-2 pr-3 text-right font-medium">
                  Amortization Due
                </th>
                {/* Charles 2026-04-25 (Bug 23): per-period rebate-applied
                    column. Only meaningful for tie-in contracts (rebates
                    retire capital there). For other contract types every
                    row would show $0, so we hide the whole column. */}
                {data.contractType === "tie_in" && (
                  <th className="py-2 pr-3 text-right font-medium">
                    Rebate Applied
                  </th>
                )}
                <th className="py-2 text-right font-medium">Closing Balance</th>
              </tr>
            </thead>
            <tbody>
              {data.schedule.map((row) => {
                const elapsed = row.periodNumber <= data.elapsedPeriods
                return (
                  <tr
                    key={row.periodNumber}
                    className={
                      "border-b last:border-0 " +
                      (elapsed ? "bg-muted/30" : "")
                    }
                  >
                    <td className="py-2 pr-3 font-medium">
                      {row.periodNumber}
                    </td>
                    <td className="py-2 pr-3 text-muted-foreground">
                      {formatCalendarDate(row.periodDate)}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {formatCurrency(row.openingBalance)}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {formatCurrency(row.interestCharge)}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {formatCurrency(row.principalDue)}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {formatCurrency(row.amortizationDue)}
                    </td>
                    {data.contractType === "tie_in" && (
                      <td
                        className={
                          "py-2 pr-3 text-right tabular-nums " +
                          (row.rebateAppliedThisPeriod > 0
                            ? "text-emerald-600"
                            : "text-muted-foreground")
                        }
                      >
                        {row.rebateAppliedThisPeriod > 0
                          ? formatCurrency(row.rebateAppliedThisPeriod)
                          : "—"}
                      </td>
                    )}
                    <td className="py-2 text-right tabular-nums">
                      {formatCurrency(row.closingBalance)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}

function TieInMinPurchaseBlock({
  data,
}: {
  data: ContractCapitalScheduleResult
}) {
  const shortfall = computeMinAnnualShortfall(
    data.rolling12Spend,
    data.minAnnualPurchase,
  )
  const retirement = computeCapitalRetirementNeeded({
    capitalAmount: data.capitalCost,
    rebatesApplied: data.rebateAppliedToCapital,
    monthsRemaining: data.monthsRemaining,
    rebatePercent: data.currentTierPercent,
  })

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="rounded-md border bg-card p-3">
        <div className="flex items-center gap-2">
          <p className="text-xs text-muted-foreground">
            Minimum Annual Purchase
          </p>
          {shortfall.floor != null ? (
            <Badge
              variant={shortfall.met ? "outline" : "destructive"}
              className="text-[10px]"
            >
              {shortfall.met
                ? "Met"
                : `short ${formatCurrency(shortfall.gap)}`}
            </Badge>
          ) : null}
        </div>
        <p className="mt-1 text-xl font-semibold tabular-nums">
          {shortfall.floor == null ? "—" : formatCurrency(shortfall.floor)}
        </p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Rolling-12 spend: {formatCurrency(shortfall.spend)}
        </p>
      </div>
      <div className="rounded-md border bg-card p-3">
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <span>Annual Spend Needed to Retire Capital</span>
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label="What is Annual Spend Needed to Retire Capital?"
                  className="inline-flex items-center text-muted-foreground hover:text-foreground"
                >
                  <HelpCircle className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                <p className="text-xs">
                  At your current tier rebate (
                  {data.currentTierPercent.toFixed(2)}%), this much annual
                  spend over the remaining {data.monthsRemaining} month
                  {data.monthsRemaining === 1 ? "" : "s"} will close the
                  amortization balance.
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <p className="mt-1 text-xl font-semibold tabular-nums">
          {retirement.annualSpendNeeded == null
            ? "—"
            : formatCurrency(retirement.annualSpendNeeded)}
        </p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Remaining capital: {formatCurrency(retirement.remainingCapital)}
        </p>
      </div>
    </div>
  )
}

function SummaryTile({
  label,
  value,
  tooltip,
}: {
  label: string
  value: string
  tooltip: string
}) {
  return (
    <div className="rounded-md border bg-card p-3">
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <span>{label}</span>
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={`What is ${label}?`}
                className="inline-flex items-center text-muted-foreground hover:text-foreground"
              >
                <HelpCircle className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              <p className="text-xs">{tooltip}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
    </div>
  )
}
