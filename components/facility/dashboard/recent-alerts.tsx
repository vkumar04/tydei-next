"use client"

import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { alertTypeIconConfig, alertSeverityBadgeConfig } from "@/components/shared/alerts/alert-config"
import { formatDate } from "@/lib/formatting"
import type { Alert } from "@prisma/client"

interface RecentAlertsProps {
  alerts: Alert[]
}

export function RecentAlerts({ alerts }: RecentAlertsProps) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between pb-2">
        <CardTitle className="text-base">Recent Alerts</CardTitle>
        <Link href="/dashboard/alerts" className="text-sm text-primary hover:underline">
          View all
        </Link>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {alerts.map((alert) => {
            const typeConfig = alertTypeIconConfig[alert.alertType]
            const sevConfig = alertSeverityBadgeConfig[alert.severity]
            const Icon = typeConfig?.icon
            return (
              <Link
                key={alert.id}
                href={`/dashboard/alerts/${alert.id}`}
                className="flex items-center gap-3 rounded-md p-2 transition-colors hover:bg-muted"
              >
                {Icon && <Icon className={`size-4 shrink-0 ${typeConfig.color}`} />}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{alert.title}</p>
                  <p className="text-xs text-muted-foreground">{formatDate(alert.createdAt)}</p>
                </div>
                {sevConfig && (
                  <Badge variant={sevConfig.variant} className={sevConfig.className}>
                    {sevConfig.label}
                  </Badge>
                )}
              </Link>
            )
          })}
          {alerts.length === 0 && (
            <p className="py-4 text-center text-sm text-muted-foreground">No active alerts</p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
