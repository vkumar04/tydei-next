"use client"

import Link from "next/link"
import { formatDistanceToNow } from "date-fns"
import { CheckCircle2, X } from "lucide-react"
import type { Alert } from "@/lib/generated/prisma/client"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { cn } from "@/lib/utils"
import { extractAlertAmount, formatAlertAmount } from "@/lib/alerts/alert-amount"

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
  onDismiss?: () => void
}

export function AlertsRow({
  alert,
  selected,
  onSelect,
  onResolve,
  onNavigate,
  onDismiss,
}: AlertsRowProps) {
  const typeConfig = alertTypeIconConfig[alert.alertType]
  const severityConfig = alertSeverityBadgeConfig[alert.severity]
  const Icon = typeConfig?.icon
  const iconClasses =
    alertColorBg[alert.alertType] ?? "text-muted-foreground bg-muted"
  const isNew = alert.status === "new_alert"
  const amount = extractAlertAmount(alert.metadata)

  return (
    <div
      className={cn(
        "flex items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/50",
        isNew && "bg-muted/30",
      )}
    >
      <Checkbox
        className="mt-1.5"
        checked={selected}
        onCheckedChange={(checked) => onSelect(Boolean(checked))}
        aria-label={`Select alert ${alert.title}`}
      />

      <div className={cn("mt-0.5 rounded-lg p-2", iconClasses)}>
        {Icon ? <Icon className="h-4 w-4" /> : null}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <button
            type="button"
            className={cn(
              "truncate text-left text-sm font-medium hover:underline",
              isNew ? "text-foreground" : "text-muted-foreground",
            )}
            onClick={onNavigate}
          >
            {alert.title}
          </button>
          {isNew ? (
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
              aria-label="New"
            />
          ) : null}
        </div>

        {alert.description ? (
          <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">
            {alert.description}
          </p>
        ) : null}

        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-muted-foreground">
            {typeConfig?.label ?? alert.alertType}
          </span>
          {alert.vendor?.name ? (
            <Badge variant="outline" className="text-[11px] font-normal">
              {alert.vendor.name}
            </Badge>
          ) : null}
          {alert.contract?.name ? (
            <Badge variant="outline" className="text-[11px] font-normal">
              {alert.contract.name}
            </Badge>
          ) : null}
          {amount != null ? (
            <Badge
              variant="outline"
              className="text-[11px] font-semibold tabular-nums text-emerald-700 dark:text-emerald-400"
            >
              {formatAlertAmount(amount)}
            </Badge>
          ) : null}
          <span className="text-[11px] text-muted-foreground">
            {formatDistanceToNow(new Date(alert.createdAt), { addSuffix: true })}
          </span>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {severityConfig ? (
          <Badge className={cn("hidden sm:inline-flex", severityConfig.className)}>
            {severityConfig.label}
          </Badge>
        ) : null}
        {alert.status !== "resolved" ? (
          <Button
            size="sm"
            variant="ghost"
            className="h-8 px-2"
            onClick={onResolve}
            title="Resolve"
          >
            <CheckCircle2 className="h-4 w-4" />
            <span className="sr-only">Resolve</span>
          </Button>
        ) : null}
        {onDismiss ? (
          <Button
            size="sm"
            variant="ghost"
            className="h-8 px-2"
            onClick={onDismiss}
            title="Dismiss"
          >
            <X className="h-4 w-4" />
            <span className="sr-only">Dismiss</span>
          </Button>
        ) : null}
        <Button asChild size="sm" variant="ghost" className="h-8 px-2 text-xs">
          <Link href={`/dashboard/alerts/${alert.id}`}>View</Link>
        </Button>
      </div>
    </div>
  )
}
