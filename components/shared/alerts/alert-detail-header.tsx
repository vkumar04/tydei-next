"use client"

import Link from "next/link"
import { formatDistanceToNow } from "date-fns"
import { AlertTriangle, ArrowLeft } from "lucide-react"
import type { Alert } from "@prisma/client"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

import {
  alertColorBg,
  alertSeverityBadgeConfig,
  alertTypeIconConfig,
  statusColors,
} from "./alert-config"

interface AlertDetailHeaderProps {
  alert: Pick<
    Alert,
    "title" | "alertType" | "severity" | "status" | "createdAt"
  >
}

export function AlertDetailHeader({ alert }: AlertDetailHeaderProps) {
  const typeConfig = alertTypeIconConfig[alert.alertType]
  const severityConfig = alertSeverityBadgeConfig[alert.severity]
  const Icon = typeConfig?.icon ?? AlertTriangle
  const colorClasses =
    alertColorBg[alert.alertType] ?? "text-muted-foreground bg-muted"

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
      <Button variant="ghost" size="icon" asChild className="self-start">
        <Link href="/dashboard/alerts" aria-label="Back to alerts">
          <ArrowLeft className="h-5 w-5" />
        </Link>
      </Button>

      <div className="flex-1 flex items-center gap-3">
        <div
          className={cn(
            "h-10 w-10 rounded-lg flex items-center justify-center",
            colorClasses,
          )}
        >
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight truncate">
            {alert.title}
          </h1>
          <p className="text-muted-foreground">
            {formatDistanceToNow(new Date(alert.createdAt), { addSuffix: true })}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {severityConfig ? (
          <Badge className={severityConfig.className}>
            {severityConfig.label.toLowerCase()} priority
          </Badge>
        ) : null}
        <Badge className={statusColors[alert.status] ?? ""}>
          {alert.status.replace("_", " ")}
        </Badge>
      </div>
    </div>
  )
}
