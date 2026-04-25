"use client"

import { useState, useMemo } from "react"
import { formatCurrency, formatDate, formatCalendarDate, formatDateRange } from "@/lib/formatting"
import { toDisplayRebateValue } from "@/lib/contracts/rebate-value-normalize"
import { contractStatusConfig } from "@/lib/constants"
import { StatusBadge } from "@/components/shared/badges/status-badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Building2,
  CalendarDays,
  Clock,
  DollarSign,
  FileSignature,
  FileText,
  Layers,
  PiggyBank,
  TrendingUp,
  Truck,
  History,
  Info,
  ListChecks,
  Receipt,
  ArrowRightLeft,
} from "lucide-react"
import type { getVendorContractDetail } from "@/lib/actions/vendor-contracts"

type ContractDetail = Awaited<ReturnType<typeof getVendorContractDetail>>

interface VendorContractOverviewProps {
  contract: ContractDetail
}

function InfoRow({ label, value, icon: Icon }: { label: string; value: React.ReactNode; icon?: React.ElementType }) {
  return (
    <div className="flex justify-between items-center py-2">
      <div className="flex items-center gap-2">
        {Icon && <Icon className="h-3.5 w-3.5 text-muted-foreground" />}
        <span className="text-sm text-muted-foreground">{label}</span>
      </div>
      <span className="text-sm font-medium text-right">{value}</span>
    </div>
  )
}

export function VendorContractOverview({ contract }: VendorContractOverviewProps) {
  const [activeTab, setActiveTab] = useState("overview")

  // Charles audit round-1 vendor C4: lifetime totals come from the
  // server-side aggregate over the FULL period table — reducing
  // over `contract.periods` was capped at the most-recent 4 rows
  // (the ledger slice) and silently under-reported lifetime numbers.
  const summary = useMemo(() => {
    const lifetime = contract.lifetimeTotals ?? {
      spend: 0,
      rebateEarned: 0,
      rebateCollected: 0,
    }
    const spendToDate = lifetime.spend
    const rebateEarned = lifetime.rebateEarned
    const rebateCollected = lifetime.rebateCollected

    const now = new Date()
    const expiration = new Date(contract.expirationDate)
    const daysRemaining = Math.max(0, Math.ceil((expiration.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))

    return { spendToDate, rebateEarned, rebateCollected, daysRemaining }
  }, [contract])

  return (
    <div className="space-y-6">
      {/* Contract Header */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-3">
                <h2 className="text-xl font-semibold">{contract.name}</h2>
                <StatusBadge status={contract.status} config={contractStatusConfig} />
              </div>
              {contract.contractNumber && (
                <p className="text-sm font-mono text-muted-foreground">{contract.contractNumber}</p>
              )}
              <div className="flex flex-wrap items-center gap-4 pt-1 text-sm text-muted-foreground">
                {contract.vendor && (
                  <div className="flex items-center gap-1.5">
                    <Truck className="h-3.5 w-3.5" />
                    <span>{contract.vendor.name}</span>
                  </div>
                )}
                {contract.facility && (
                  <div className="flex items-center gap-1.5">
                    <Building2 className="h-3.5 w-3.5" />
                    <span>{contract.facility.name}</span>
                  </div>
                )}
                {contract.productCategory && (
                  <div className="flex items-center gap-1.5">
                    <Layers className="h-3.5 w-3.5" />
                    <span>{contract.productCategory.name}</span>
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <CalendarDays className="h-3.5 w-3.5" />
              <span>{formatCalendarDate(contract.effectiveDate)} - {formatCalendarDate(contract.expirationDate)}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-blue-500" />
              <span className="text-sm text-muted-foreground">Total Value</span>
            </div>
            <div className="text-2xl font-bold mt-1">{formatCurrency(Number(contract.totalValue))}</div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {formatCurrency(Number(contract.annualValue))}/yr
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-green-500" />
              <span className="text-sm text-muted-foreground">Spend to Date</span>
            </div>
            <div className="text-2xl font-bold mt-1">{formatCurrency(summary.spendToDate)}</div>
            {Number(contract.totalValue) > 0 && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {((summary.spendToDate / Number(contract.totalValue)) * 100).toFixed(1)}% of total
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <PiggyBank className="h-4 w-4 text-purple-500" />
              <span className="text-sm text-muted-foreground">Rebate Earned</span>
            </div>
            <div className="text-2xl font-bold mt-1">{formatCurrency(summary.rebateEarned)}</div>
            {/* Charles audit round-3 vendor: surface lifetime collected
                alongside earned so vendor sees what's actually been
                paid out. */}
            <p className="text-xs text-muted-foreground mt-0.5">
              {formatCurrency(summary.rebateCollected)} collected
              {summary.spendToDate > 0 && (
                <>
                  {" · "}
                  {((summary.rebateEarned / summary.spendToDate) * 100).toFixed(2)}% effective rate
                </>
              )}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-orange-500" />
              <span className="text-sm text-muted-foreground">Days Remaining</span>
            </div>
            <div className={`text-2xl font-bold mt-1 ${summary.daysRemaining <= 30 ? "text-red-600 dark:text-red-400" : summary.daysRemaining <= 90 ? "text-yellow-600 dark:text-yellow-400" : ""}`}>
              {summary.daysRemaining}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Expires {formatCalendarDate(contract.expirationDate)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Content Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="overview">
            <Info className="h-3.5 w-3.5 mr-1" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="terms">
            <ListChecks className="h-3.5 w-3.5 mr-1" />
            Terms
          </TabsTrigger>
          <TabsTrigger value="transactions">
            <Receipt className="h-3.5 w-3.5 mr-1" />
            Transactions
          </TabsTrigger>
          <TabsTrigger value="amendments">
            <History className="h-3.5 w-3.5 mr-1" />
            Amendments
          </TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Contract Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              <InfoRow icon={FileSignature} label="Contract Type" value={<span className="capitalize">{contract.contractType.replace("_", " ")}</span>} />
              {contract.contractNumber && <InfoRow icon={FileText} label="Contract Number" value={contract.contractNumber} />}
              {contract.facility && <InfoRow icon={Building2} label="Facility" value={contract.facility.name} />}
              {contract.productCategory && <InfoRow icon={Layers} label="Category" value={contract.productCategory.name} />}

              <Separator className="my-2" />

              <InfoRow icon={CalendarDays} label="Effective Date" value={formatCalendarDate(contract.effectiveDate)} />
              <InfoRow icon={CalendarDays} label="Expiration Date" value={formatCalendarDate(contract.expirationDate)} />
              <InfoRow label="Auto-Renewal" value={contract.autoRenewal ? "Yes" : "No"} />
              <InfoRow label="Termination Notice" value={`${contract.terminationNoticeDays} days`} />

              <Separator className="my-2" />

              <InfoRow icon={DollarSign} label="Total Value" value={formatCurrency(Number(contract.totalValue))} />
              <InfoRow icon={DollarSign} label="Annual Value" value={formatCurrency(Number(contract.annualValue))} />
              <InfoRow label="Performance Period" value={<span className="capitalize">{contract.performancePeriod.replace("_", " ")}</span>} />
              <InfoRow label="Rebate Pay Period" value={<span className="capitalize">{contract.rebatePayPeriod.replace("_", " ")}</span>} />

              {contract.gpoAffiliation && (
                <>
                  <Separator className="my-2" />
                  <InfoRow label="GPO Affiliation" value={contract.gpoAffiliation} />
                </>
              )}

              {contract.description && (
                <>
                  <Separator className="my-2" />
                  <div className="py-2">
                    <p className="text-sm text-muted-foreground mb-1">Description</p>
                    <p className="text-sm">{contract.description}</p>
                  </div>
                </>
              )}

              {contract.notes && (
                <div className="py-2">
                  <p className="text-sm text-muted-foreground mb-1">Notes</p>
                  <p className="text-sm">{contract.notes}</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Terms Tab */}
        <TabsContent value="terms">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Contract Terms</CardTitle>
            </CardHeader>
            <CardContent>
              {(!contract.terms || contract.terms.length === 0) ? (
                <div className="text-center py-8">
                  <ListChecks className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">No terms defined for this contract</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {contract.terms.map((term) => (
                    <div key={term.id} className="rounded-lg border p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{term.termName}</span>
                          <Badge variant="secondary" className="capitalize text-xs">
                            {term.termType.replace(/_/g, " ")}
                          </Badge>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {formatCalendarDate(term.effectiveStart)} - {formatCalendarDate(term.effectiveEnd)}
                        </span>
                      </div>

                      <div className="grid gap-2 text-sm sm:grid-cols-3">
                        <div>
                          <span className="text-muted-foreground">Baseline: </span>
                          <span className="capitalize">{term.baselineType.replace("_", " ")}</span>
                        </div>
                        {term.spendBaseline && (
                          <div>
                            <span className="text-muted-foreground">Spend Baseline: </span>
                            {formatCurrency(Number(term.spendBaseline))}
                          </div>
                        )}
                        <div>
                          <span className="text-muted-foreground">Evaluation: </span>
                          <span className="capitalize">{term.evaluationPeriod}</span>
                        </div>
                      </div>

                      {term.tiers && term.tiers.length > 0 && (
                        <div className="space-y-2">
                          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Tiers</p>
                          {term.tiers.map((tier) => (
                            <div key={tier.id} className="flex items-center gap-3 rounded-md border p-2.5 bg-muted/30">
                              <Badge variant="outline" className="shrink-0 text-xs">
                                {/* Charles audit round-3 vendor: surface
                                    tierName when present (e.g. "Bronze") so
                                    the vendor sees what facility sees. */}
                                {tier.tierName ?? `Tier ${tier.tierNumber}`}
                              </Badge>
                              <div className="flex-1 flex justify-between text-sm">
                                <span className="text-muted-foreground">
                                  {formatCurrency(Number(tier.spendMin))}
                                  {tier.spendMax ? ` - ${formatCurrency(Number(tier.spendMax))}` : "+"}
                                </span>
                                <span className="font-medium">
                                  {/*
                                   * Charles 2026-04-25: ContractTier.rebateValue
                                   * is stored as a fraction (0.03 = 3%); displaying
                                   * `Number(tier.rebateValue).toFixed(1)` rendered
                                   * "0.0%" on every tier in the vendor portal.
                                   * Route through the canonical scaler.
                                   */}
                                  {tier.rebateType === "percent_of_spend"
                                    ? `${toDisplayRebateValue("percent_of_spend", Number(tier.rebateValue)).toFixed(1)}%`
                                    : formatCurrency(Number(tier.rebateValue), true)}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Transactions Tab */}
        <TabsContent value="transactions">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recent Transactions</CardTitle>
            </CardHeader>
            <CardContent>
              {(!contract.periods || contract.periods.length === 0) ? (
                <div className="text-center py-8">
                  <Receipt className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">No transaction data available yet</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Period</TableHead>
                      <TableHead>Spend</TableHead>
                      <TableHead>Volume</TableHead>
                      <TableHead>Rebate Earned</TableHead>
                      <TableHead>Payment</TableHead>
                      <TableHead>Tier</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {contract.periods.map((period) => (
                      <TableRow key={period.id}>
                        <TableCell>
                          <span className="text-sm">
                            {formatDateRange(period.periodStart, period.periodEnd)}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className="font-medium">{formatCurrency(Number(period.totalSpend))}</span>
                        </TableCell>
                        <TableCell>
                          <span className="text-sm">{period.totalVolume.toLocaleString()}</span>
                        </TableCell>
                        <TableCell>
                          <span className="text-sm font-medium text-green-600 dark:text-green-400">
                            {formatCurrency(Number(period.rebateEarned))}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className="text-sm">
                            {formatCurrency(Number(period.paymentActual))}
                            {Number(period.paymentExpected) > 0 && Number(period.paymentActual) !== Number(period.paymentExpected) && (
                              <span className="text-xs text-muted-foreground ml-1">
                                / {formatCurrency(Number(period.paymentExpected))}
                              </span>
                            )}
                          </span>
                        </TableCell>
                        <TableCell>
                          {period.tierAchieved ? (
                            <Badge variant="outline">Tier {period.tierAchieved}</Badge>
                          ) : (
                            <span className="text-muted-foreground text-sm">--</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Amendments Tab */}
        <TabsContent value="amendments">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Amendment History</CardTitle>
            </CardHeader>
            <CardContent>
              {(!contract.changeProposals || contract.changeProposals.length === 0) ? (
                <div className="text-center py-8">
                  <History className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">No amendments have been made to this contract</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {contract.changeProposals.map((proposal) => (
                    <div key={proposal.id} className="flex items-start gap-3 rounded-lg border p-4">
                      <div className="rounded-full bg-muted p-2">
                        <ArrowRightLeft className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="flex-1 space-y-1">
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-medium capitalize">{proposal.proposalType?.replace(/_/g, " ") ?? "Amendment"}</p>
                          <Badge variant="outline" className="capitalize text-xs">
                            {proposal.status?.replace(/_/g, " ") ?? "unknown"}
                          </Badge>
                        </div>
                        {proposal.vendorMessage && (
                          <p className="text-sm text-muted-foreground">{proposal.vendorMessage}</p>
                        )}
                        <p className="text-xs text-muted-foreground">
                          Submitted {formatDate(proposal.submittedAt)}
                          {proposal.reviewedAt && (
                            <span> &middot; Reviewed {formatDate(proposal.reviewedAt)}</span>
                          )}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
