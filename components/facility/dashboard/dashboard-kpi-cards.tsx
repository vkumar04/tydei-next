"use client"

/**
 * Facility dashboard — 6-card KPI grid.
 *
 * Canonical card set per the dashboard-rewrite spec subsystem 1:
 *   1. Total Contracts (from getContractStats)
 *   2. Active Contracts (from getDashboardKPISummary)
 *   3. Total Value (from getDashboardKPISummary.totalContractValue)
 *   4. Spend YTD (from getDashboardKPISummary.totalSpendYTD)
 *   5. Rebates Earned (from getDashboardKPISummary.totalRebatesEarned)
 *   6. Pending Alerts (from getDashboardKPISummary.pendingAlerts)
 *
 * All cards render with an identical slot structure so the grid stays
 * visually uniform. No `any` types; pure presentation.
 */

import type { LucideIcon } from "lucide-react"
import {
  FileTextIcon,
  FileSignatureIcon,
  BanknoteIcon,
  DollarSignIcon,
  TrendingUpIcon,
  AlertTriangleIcon,
} from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { formatCurrency } from "@/lib/formatting"

export interface DashboardKPICardsProps {
  totalContracts: number
  activeContracts: number
  totalContractValue: number
  totalSpendYTD: number
  /** Subset of totalSpendYTD where COGRecord.matchStatus is on_contract
   *  or price_variance. Surfaced on the Total Spend card so facilities
   *  see leakage inline. */
  onContractSpendYTD: number
  totalRebatesEarned: number
  /** Subset of totalRebatesEarned with a collectionDate set. Rendered
   *  as the secondary value under Rebates Earned. */
  totalRebatesCollected: number
  pendingAlerts: number
}

interface CardSpec {
  title: string
  value: string
  subLabel: string
  icon: LucideIcon
  accent: "primary" | "success" | "warning" | "destructive" | "info"
  secondaryValue?: string
  secondaryLabel?: string
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value)
}

const ACCENT_CLASS: Record<CardSpec["accent"], string> = {
  primary: "bg-primary/10 text-primary",
  success: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  warning: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  destructive: "bg-destructive/10 text-destructive",
  info: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
}

export function DashboardKPICards({
  totalContracts,
  activeContracts,
  totalContractValue,
  totalSpendYTD,
  onContractSpendYTD,
  totalRebatesEarned,
  totalRebatesCollected,
  pendingAlerts,
}: DashboardKPICardsProps) {
  const cards: CardSpec[] = [
    {
      title: "Total Contracts",
      value: formatCount(totalContracts),
      subLabel: "across portfolio",
      icon: FileTextIcon,
      accent: "primary",
    },
    {
      title: "Active",
      value: formatCount(activeContracts),
      subLabel: "in active portfolio",
      icon: FileSignatureIcon,
      accent: "success",
    },
    {
      title: "Total Value",
      value: formatCurrency(totalContractValue),
      subLabel: "across portfolio",
      icon: BanknoteIcon,
      accent: "info",
    },
    {
      // Dashboard title renamed from "Spend YTD" to "Total Spend" so the
      // E2E regression spec (facility-dashboard-rebates-live.spec.ts)
      // can key the card by its combined text. `secondaryValue` exposes
      // the on-contract subset inline.
      title: "Total Spend",
      value: formatCurrency(totalSpendYTD),
      subLabel: "YTD spend",
      icon: DollarSignIcon,
      accent: "info",
      secondaryValue: formatCurrency(onContractSpendYTD),
      secondaryLabel: "On Contract",
    },
    {
      // "Rebates Earned" keeps its label; `secondaryValue` carries the
      // collected-lifetime companion that facilities read alongside.
      title: "Rebates",
      value: formatCurrency(totalRebatesEarned),
      subLabel: "earned from contracts",
      icon: TrendingUpIcon,
      accent: "success",
      secondaryValue: formatCurrency(totalRebatesCollected),
      secondaryLabel: "Collected",
    },
    {
      title: "Pending Alerts",
      value: formatCount(pendingAlerts),
      subLabel: pendingAlerts === 0 ? "all clear" : "review in Alerts",
      icon: AlertTriangleIcon,
      accent: pendingAlerts === 0 ? "success" : "warning",
    },
  ]

  return (
    <div
      className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6"
      role="list"
      aria-label="Key performance indicators"
    >
      {cards.map((c) => (
        <KpiCard key={c.title} spec={c} />
      ))}
    </div>
  )
}

function KpiCard({ spec }: { spec: CardSpec }) {
  const Icon = spec.icon
  return (
    <Card className="py-0" role="listitem">
      <CardContent className="flex flex-col gap-3 p-5">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {spec.title}
          </p>
          <span
            className={`flex h-8 w-8 items-center justify-center rounded-lg ${ACCENT_CLASS[spec.accent]}`}
          >
            <Icon className="h-4 w-4" />
          </span>
        </div>
        <p className="text-2xl font-bold tabular-nums leading-tight">
          {spec.value}
        </p>
        {spec.secondaryValue != null ? (
          <p className="text-sm font-medium tabular-nums text-muted-foreground">
            {spec.secondaryValue}
            <span className="ml-1 text-xs font-normal">
              {spec.secondaryLabel}
            </span>
          </p>
        ) : null}
        <p className="text-xs text-muted-foreground">{spec.subLabel}</p>
      </CardContent>
    </Card>
  )
}
