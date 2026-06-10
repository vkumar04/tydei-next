"use client"

/**
 * 12-month lookback projection + existing-contract comparison for an
 * uploaded proposal (Charles 2026-06-10: "should do a 12 month look back
 * and predict what rebates etc would be and compare to other contracts
 * from that vendor if they exist").
 *
 * Everything here is a PROJECTION surface — the predicted rebate is the
 * proposal's extracted tier ladder run against real trailing-12-month COG
 * spend, never an earned figure (CLAUDE.md rebates rule).
 */

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Loader2, TrendingUp } from "lucide-react"
import { formatCurrency, formatDate } from "@/lib/formatting"
import type { VendorLookbackComparison } from "@/lib/actions/prospective-analysis"

export function ProposalLookbackCard({
  lookback,
  isLoading,
}: {
  lookback: VendorLookbackComparison | null
  isLoading: boolean
}) {
  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Running 12-month lookback…
        </CardContent>
      </Card>
    )
  }
  if (!lookback) return null

  const { predicted } = lookback

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <TrendingUp className="h-4 w-4" />
          12-month lookback projection
          {lookback.vendorName ? (
            <Badge variant="outline">{lookback.vendorName}</Badge>
          ) : null}
        </CardTitle>
        <CardDescription>
          The proposal&rsquo;s extracted tiers applied to your real
          trailing-12-month spend — a projection, not earned rebate.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {lookback.vendorId === null ? (
          <p className="text-sm text-muted-foreground">
            Couldn&rsquo;t match the proposal to a known vendor — pick the
            vendor in the selector above and re-drop the PDF to run the
            lookback.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
              <div>
                <p className="text-muted-foreground">Spend (last 12 mo)</p>
                <p className="text-xl font-bold tabular-nums">
                  {formatCurrency(lookback.trailing12moSpend)}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Projected tier</p>
                <p className="text-xl font-bold tabular-nums">
                  {predicted
                    ? `Tier ${predicted.tierAchieved} · ${predicted.rebatePercent.toFixed(1)}%`
                    : "—"}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">
                  Projected rebate / yr
                </p>
                <p className="text-xl font-bold tabular-nums text-emerald-600">
                  {predicted ? formatCurrency(predicted.annualRebate) : "—"}
                </p>
              </div>
            </div>
            {lookback.trailing12moSpend === 0 ? (
              <p className="text-xs text-muted-foreground">
                No COG spend recorded for this vendor in the last 12 months —
                the projection has nothing to run against.
              </p>
            ) : !predicted ? (
              <p className="text-xs text-muted-foreground">
                Last-12-month spend doesn&rsquo;t reach the proposal&rsquo;s
                lowest tier threshold — at current pace this proposal earns
                $0.
              </p>
            ) : null}

            {lookback.existingContracts.length > 0 ? (
              <div className="space-y-1">
                <p className="text-sm font-medium">
                  Existing {lookback.vendorName} contracts
                </p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Contract</TableHead>
                      <TableHead className="text-right">
                        Lifetime earned
                      </TableHead>
                      <TableHead className="text-right">
                        Effective rate
                      </TableHead>
                      <TableHead className="text-right">Top tier</TableHead>
                      <TableHead className="text-right">Expires</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lookback.existingContracts.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell>
                          <span className="font-medium">{c.name}</span>{" "}
                          <Badge variant="outline" className="ml-1 text-[10px]">
                            {c.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatCurrency(c.lifetimeEarned)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {c.effectiveRatePct !== null
                            ? `${c.effectiveRatePct.toFixed(2)}%`
                            : "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {c.topTierRatePct !== null
                            ? `${c.topTierRatePct.toFixed(1)}%`
                            : "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          {c.expirationDate
                            ? formatDate(c.expirationDate)
                            : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {predicted ? (
                  <p className="text-xs text-muted-foreground">
                    Proposal projects{" "}
                    <span className="font-medium text-foreground">
                      {predicted.rebatePercent.toFixed(1)}%
                    </span>{" "}
                    at your current spend vs{" "}
                    {(() => {
                      const best = lookback.existingContracts
                        .map((c) => c.effectiveRatePct)
                        .filter((r): r is number => r !== null)
                        .reduce((max, r) => (r > max ? r : max), 0)
                      return best > 0
                        ? `a best effective ${best.toFixed(2)}% on the existing contracts.`
                        : "no measurable effective rate on the existing contracts."
                    })()}
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                No existing contracts with this vendor at your facility — this
                would be a net-new relationship.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
