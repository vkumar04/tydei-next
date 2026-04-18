"use client"

/**
 * Facility dashboard — top-5 ranked alerts.
 *
 * Consumes `RankedAlert[]` from
 * `lib/actions/dashboard/kpi.ts::getDashboardKPISummary.topAlerts`.
 * Each row links to `/dashboard/alerts/{id}`.
 */

import Link from "next/link"
import { formatDistanceToNow } from "date-fns"
import { AlertTriangleIcon, ArrowRightIcon, CheckCircleIcon } from "lucide-react"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  alertTypeIconConfig,
  alertSeverityBadgeConfig,
} from "@/components/shared/alerts/alert-config"
import type { RankedAlert } from "@/lib/alerts/priority-ranker"
import { formatCurrency } from "@/lib/formatting"

interface DashboardTopAlertsProps {
  alerts: RankedAlert[]
  totalUnresolved: number
}

export function DashboardTopAlerts({
  alerts,
  totalUnresolved,
}: DashboardTopAlertsProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2">
            Top Alerts
            {totalUnresolved > 0 && (
              <Badge variant="destructive" className="text-[10px]">
                {totalUnresolved} unresolved
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            Highest-priority actions ranked by severity, impact, and age
          </CardDescription>
        </div>
        <Button asChild variant="ghost" size="sm">
          <Link href="/dashboard/alerts">
            View all
            <ArrowRightIcon className="ml-2 h-4 w-4" />
          </Link>
        </Button>
      </CardHeader>
      <CardContent>
        {alerts.length === 0 ? (
          <div className="flex h-[240px] flex-col items-center justify-center gap-2 text-muted-foreground">
            <CheckCircleIcon className="h-10 w-10 text-emerald-500 opacity-80" />
            <p className="font-medium">No alerts</p>
            <p className="text-xs">You&apos;re all caught up!</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {alerts.map((alert) => (
              <TopAlertRow key={alert.id} alert={alert} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function TopAlertRow({ alert }: { alert: RankedAlert }) {
  const cfg = alertTypeIconConfig[alert.alertType]
  const Icon = cfg?.icon ?? AlertTriangleIcon
  const iconColor = cfg?.color ?? "text-amber-500"
  const typeLabel = cfg?.label ?? alert.alertType
  const severity = alertSeverityBadgeConfig[alert.severity]
  const createdAt =
    alert.createdAt instanceof Date
      ? alert.createdAt
      : new Date(alert.createdAt)

  return (
    <li>
      <Link
        href={`/dashboard/alerts/${alert.id}`}
        className="flex items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/50"
      >
        <div className={`mt-0.5 ${iconColor}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium leading-none">{typeLabel}</p>
            {severity && (
              <Badge className={`text-[10px] ${severity.className}`}>
                {severity.label}
              </Badge>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>
              {formatDistanceToNow(createdAt, { addSuffix: true })}
            </span>
            {typeof alert.dollarImpact === "number" && alert.dollarImpact > 0 && (
              <span className="font-medium text-foreground">
                {formatCurrency(alert.dollarImpact)}
              </span>
            )}
            <span className="tabular-nums">
              score {Math.round(alert.priorityScore)}
            </span>
          </div>
        </div>
        <ArrowRightIcon className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
      </Link>
    </li>
  )
}
