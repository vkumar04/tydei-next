"use client"

/**
 * Detail dialog tabs for a single renewal.
 *
 * Tabs: Overview / Performance / Negotiation / Notes / Settings.
 *
 * - Overview   — status banner + current-terms + renewal task checklist
 * - Performance — real history table (empty state when no closed periods)
 * - Negotiation — rule-based points from `generateNegotiationPoints`
 * - Notes      — delegated to RenewalNotesSection
 * - Settings   — delegated to RenewalAlertSettingsForm
 *
 * Pure presentational engine calls (`generateRenewalTasks`,
 * `generateNegotiationPoints`) are computed here against the caller-
 * supplied row data — no server fetching. The tab content that does fetch
 * (Notes, Settings) is isolated in its own child.
 */

import { useMemo } from "react"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { AlertTriangle, CheckCircle2, Clock, Info } from "lucide-react"
import {
  classifyRenewalStatus,
  generateNegotiationPoints,
  type PerformanceHistoryRow,
  type RenewalStatus,
} from "@/lib/renewals/engine"
import { formatCurrency, formatDate } from "@/lib/formatting"
import { RenewalNotesSection } from "./renewal-notes-section"
import { RenewalAlertSettingsForm } from "./renewal-alert-settings-form"
import { RenewalTaskChecklist } from "./renewal-task-checklist"

export interface RenewalDetail {
  id: string
  name: string
  contractNumber: string | null
  vendorName: string
  expirationDate: string
  daysUntilExpiry: number
  totalSpend: number
  rebatesEarned: number
  /** 0..100+; null when commitment can't be computed. */
  commitmentMet: number | null
  /**
   * Plan 2026-04-18 Task 4: raw `currentMarketShare / marketShareCommitment`
   * percentage (unrounded) — `null` when commitment data is missing.
   */
  commitmentProgressPercent: number | null
  currentTier: number
  maxTier: number
  tier: { current: number; total: number }
  currentMarketShare: number | null
  marketShareCommitment: number | null
  performanceHistory: PerformanceHistoryRow[]
}

interface RenewalDetailTabsProps {
  detail: RenewalDetail
  currentUserId: string
}

const statusBannerClass: Record<RenewalStatus, string> = {
  critical:
    "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/30",
  warning:
    "border-yellow-200 bg-yellow-50 dark:border-yellow-900 dark:bg-yellow-950/30",
  upcoming:
    "border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/30",
  ok: "border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950/30",
}

const statusLabel: Record<RenewalStatus, string> = {
  critical: "Critical — immediate action",
  warning: "Warning — start negotiations",
  upcoming: "Upcoming — plan ahead",
  ok: "On Track",
}

function statusIcon(status: RenewalStatus) {
  if (status === "critical") return AlertTriangle
  if (status === "warning") return Clock
  if (status === "upcoming") return Info
  return CheckCircle2
}

export function RenewalDetailTabs({
  detail,
  currentUserId,
}: RenewalDetailTabsProps) {
  const status = classifyRenewalStatus(detail.daysUntilExpiry)

  const negotiationPoints = useMemo(
    () =>
      generateNegotiationPoints({
        commitmentMet: detail.commitmentMet ?? 0,
        currentMarketShare: detail.currentMarketShare,
        marketShareCommitment: detail.marketShareCommitment,
        currentTier: detail.currentTier,
        maxTier: detail.maxTier,
      }),
    [
      detail.commitmentMet,
      detail.currentMarketShare,
      detail.marketShareCommitment,
      detail.currentTier,
      detail.maxTier,
    ],
  )

  const StatusIcon = statusIcon(status)
  const commitmentText =
    detail.commitmentProgressPercent === null
      ? "—"
      : `${Math.round(detail.commitmentProgressPercent)}%`

  return (
    <Tabs defaultValue="overview" className="w-full">
      <TabsList className="grid w-full grid-cols-5">
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="performance">Performance</TabsTrigger>
        <TabsTrigger value="negotiation">Negotiation</TabsTrigger>
        <TabsTrigger value="notes">Notes</TabsTrigger>
        <TabsTrigger value="settings">Settings</TabsTrigger>
      </TabsList>

      <TabsContent value="overview" className="space-y-4 pt-4">
        <Alert className={statusBannerClass[status]}>
          <StatusIcon className="h-4 w-4" />
          <AlertTitle>{statusLabel[status]}</AlertTitle>
          <AlertDescription>
            {detail.daysUntilExpiry < 0
              ? `Expired ${Math.abs(detail.daysUntilExpiry)} days ago on ${formatDate(detail.expirationDate)}.`
              : `${detail.daysUntilExpiry} days until expiration on ${formatDate(detail.expirationDate)}.`}
          </AlertDescription>
        </Alert>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Total Spend</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">
                {formatCurrency(detail.totalSpend)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Commitment Met</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">
                {commitmentText}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Rebates Earned</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">
                {formatCurrency(detail.rebatesEarned)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Tier</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">
                {detail.tier.current}/{detail.tier.total}
              </p>
            </CardContent>
          </Card>
        </div>

        <div>
          <h4 className="mb-2 text-sm font-medium">Renewal prep checklist</h4>
          <RenewalTaskChecklist
            contractId={detail.id}
            commitmentMet={detail.commitmentMet ?? 0}
          />
        </div>
      </TabsContent>

      <TabsContent value="performance" className="space-y-3 pt-4">
        <div>
          <h4 className="text-sm font-medium">Performance history</h4>
          <p className="text-xs text-muted-foreground">
            Aggregated from closed contract periods and recorded rebate accruals.
          </p>
        </div>
        {detail.performanceHistory.length === 0 ? (
          <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
            Insufficient history — first-year contract or no closed periods
            yet.
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Year</TableHead>
                  <TableHead className="text-right">Spend</TableHead>
                  <TableHead className="text-right">Rebate</TableHead>
                  <TableHead className="text-right">Compliance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.performanceHistory.map((row) => (
                  <TableRow key={row.year}>
                    <TableCell className="font-medium">{row.year}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(row.spend)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(row.rebate)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.compliance === null
                        ? "—"
                        : `${Math.round(row.compliance)}%`}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </TabsContent>

      <TabsContent value="negotiation" className="space-y-3 pt-4">
        <div>
          <h4 className="text-sm font-medium">Negotiation recommendations</h4>
          <p className="text-xs text-muted-foreground">
            Rule-based points derived from this contract&rsquo;s current
            performance.
          </p>
        </div>
        <ol className="list-decimal space-y-2 pl-6 text-sm">
          {negotiationPoints.map((point, i) => (
            <li key={i}>{point}</li>
          ))}
        </ol>
        <div className="flex flex-wrap gap-2 pt-2">
          <Badge variant="secondary">
            Commitment: {commitmentText}
          </Badge>
          <Badge variant="secondary">
            Tier {detail.currentTier}/{detail.maxTier}
          </Badge>
          {detail.currentMarketShare !== null ? (
            <Badge variant="secondary">
              Market share: {Math.round(detail.currentMarketShare)}%
            </Badge>
          ) : null}
        </div>
      </TabsContent>

      <TabsContent value="notes" className="pt-4">
        <RenewalNotesSection
          contractId={detail.id}
          currentUserId={currentUserId}
        />
      </TabsContent>

      <TabsContent value="settings" className="pt-4">
        <RenewalAlertSettingsForm />
      </TabsContent>
    </Tabs>
  )
}
