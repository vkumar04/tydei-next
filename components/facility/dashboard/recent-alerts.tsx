"use client"

import Link from "next/link"
import { ArrowRightIcon, AlertTriangleIcon } from "lucide-react"
import { formatDistanceToNow } from "date-fns"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { alertTypeIconConfig } from "@/components/shared/alerts/alert-config"
import type { Alert } from "@prisma/client"

const statusBadgeColors: Record<string, string> = {
  new_alert: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300",
  read: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300",
  resolved: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
}

interface RecentAlertsProps {
  alerts: Alert[]
}

export function RecentAlerts({ alerts }: RecentAlertsProps) {
  const newCount = alerts.filter((a) => a.status === "new_alert").length

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            Alerts
            {newCount > 0 && (
              <Badge className="bg-destructive text-destructive-foreground">
                {newCount} new
              </Badge>
            )}
          </CardTitle>
          <CardDescription>Recent notifications and warnings</CardDescription>
        </div>
        <Button asChild variant="ghost" size="sm">
          <Link href="/dashboard/alerts">
            View all
            <ArrowRightIcon className="ml-2 h-4 w-4" />
          </Link>
        </Button>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[350px] pr-4">
          <div className="flex flex-col gap-4">
            {alerts.map((alert) => {
              const typeConfig = alertTypeIconConfig[alert.alertType]
              const Icon = typeConfig?.icon ?? AlertTriangleIcon
              const iconColor = typeConfig?.color ?? "text-yellow-500"
              return (
                <Link
                  key={alert.id}
                  href={`/dashboard/alerts/${alert.id}`}
                  className="flex gap-4 rounded-lg border p-4 transition-colors hover:bg-muted/50"
                >
                  <div className={`mt-0.5 ${iconColor}`}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="flex-1 space-y-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium leading-none">
                        {alert.title}
                      </p>
                      <Badge
                        className={`text-xs ${statusBadgeColors[alert.status] ?? statusBadgeColors.read}`}
                      >
                        {alert.status === "new_alert" ? "new" : alert.status}
                      </Badge>
                    </div>
                    {alert.description && (
                      <p className="text-sm text-muted-foreground line-clamp-2">
                        {alert.description}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(alert.createdAt), {
                        addSuffix: true,
                      })}
                    </p>
                  </div>
                </Link>
              )
            })}
            {alerts.length === 0 && (
              <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                <p>No active alerts</p>
              </div>
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  )
}
