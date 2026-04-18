"use client"

import Link from "next/link"
import { formatDistanceToNow } from "date-fns"
import { CheckCircle, ChevronRight } from "lucide-react"
import type { Alert } from "@prisma/client"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { cn } from "@/lib/utils"

import {
  alertColorBg,
  alertSeverityBadgeConfig,
  alertTypeIconConfig,
} from "./alert-config"

export type AlertRowItem = Alert & {
  contract?: { id: string; name: string } | null
  vendor?: { id: string; name: string } | null
}

interface AlertsRowProps {
  alert: AlertRowItem
  selected: boolean
  onSelect: (checked: boolean) => void
  onResolve: () => void
  onNavigate: () => void
}

export function AlertsRow({
  alert,
  selected,
  onSelect,
  onResolve,
  onNavigate,
}: AlertsRowProps) {
  const typeConfig = alertTypeIconConfig[alert.alertType]
  const severityConfig = alertSeverityBadgeConfig[alert.severity]
  const Icon = typeConfig?.icon
  const iconClasses =
    alertColorBg[alert.alertType] ?? "text-muted-foreground bg-muted"
  const isNew = alert.status === "new_alert"

  return (
    <div
      className={cn(
        "flex items-start gap-4 px-4 py-4 border-b transition-colors hover:bg-muted/50",
        isNew && "bg-muted/30",
      )}
    >
      <Checkbox
        checked={selected}
        onCheckedChange={(checked) => onSelect(Boolean(checked))}
        aria-label={`Select alert ${alert.title}`}
      />

      <div className={cn("p-2 rounded-lg", iconClasses)}>
        {Icon ? <Icon className="h-5 w-5" /> : null}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              className={cn(
                "text-left font-medium truncate hover:underline",
                isNew ? "text-foreground" : "text-muted-foreground",
              )}
              onClick={onNavigate}
            >
              {alert.title}
            </button>
            {isNew && severityConfig ? (
              <Badge className={severityConfig.className}>
                {severityConfig.label.toLowerCase()}
              </Badge>
            ) : null}
          </div>
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            {formatDistanceToNow(new Date(alert.createdAt), { addSuffix: true })}
          </span>
        </div>

        {alert.description ? (
          <p className="text-sm text-muted-foreground mt-1">
            {alert.description}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2 mt-2">
          {alert.vendor?.name ? (
            <Badge variant="outline" className="text-xs">
              {alert.vendor.name}
            </Badge>
          ) : null}
          {alert.contract?.name ? (
            <Badge variant="outline" className="text-xs">
              {alert.contract.name}
            </Badge>
          ) : null}
        </div>

        <div className="flex items-center gap-2 mt-3">
          <Button asChild size="sm" variant="outline">
            <Link href={`/dashboard/alerts/${alert.id}`}>
              View Details
              <ChevronRight className="ml-1 h-3 w-3" />
            </Link>
          </Button>
          {alert.status !== "resolved" ? (
            <Button size="sm" variant="ghost" onClick={onResolve}>
              <CheckCircle className="mr-1 h-3 w-3" />
              Resolve
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
