"use client"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { alertTypeIconConfig, alertSeverityBadgeConfig, alertColorBg } from "./alert-config"
import { formatDistanceToNow } from "date-fns"
import { CheckCircle, ChevronRight } from "lucide-react"
import Link from "next/link"
import type { Alert } from "@prisma/client"

interface AlertCardProps {
  alert: Alert & {
    contract?: { id: string; name: string } | null
    vendor?: { id: string; name: string } | null
  }
  onResolve: () => void
  onDismiss: () => void
  onNavigate: () => void
  selected?: boolean
  onSelect?: (checked: boolean) => void
}

export function AlertCard({
  alert,
  onResolve,
  onNavigate,
  selected,
  onSelect,
}: AlertCardProps) {
  const typeConfig = alertTypeIconConfig[alert.alertType]
  const severityConfig = alertSeverityBadgeConfig[alert.severity]
  const Icon = typeConfig?.icon
  const colorClasses = alertColorBg[alert.alertType] ?? "text-muted-foreground bg-muted"
  const isNew = alert.status === "new_alert"

  return (
    <div
      className={`flex items-start gap-4 px-4 py-4 border-b transition-colors hover:bg-muted/50 ${
        isNew ? "bg-muted/30" : ""
      }`}
    >
      {onSelect && (
        <Checkbox
          checked={selected}
          onCheckedChange={onSelect}
        />
      )}
      <div className={`p-2 rounded-lg ${colorClasses}`}>
        {Icon && <Icon className="h-5 w-5" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <p className={`font-medium ${isNew ? "" : "text-muted-foreground"}`}>
              {alert.title}
            </p>
            {isNew && severityConfig && (
              <Badge className={severityConfig.className}>
                {severityConfig.label.toLowerCase()}
              </Badge>
            )}
          </div>
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            {formatDistanceToNow(new Date(alert.createdAt), { addSuffix: true })}
          </span>
        </div>
        {alert.description && (
          <p className="text-sm text-muted-foreground mt-1">{alert.description}</p>
        )}

        {/* Metadata badges */}
        <div className="flex flex-wrap gap-2 mt-2">
          {alert.vendor?.name && (
            <Badge variant="outline" className="text-xs">
              {alert.vendor.name}
            </Badge>
          )}
          {alert.contract?.name && (
            <Badge variant="outline" className="text-xs">
              {alert.contract.name}
            </Badge>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2 mt-3">
          <Button asChild size="sm" variant="outline">
            <Link href={alert.actionLink ?? `/dashboard/alerts/${alert.id}`}>
              View Details
              <ChevronRight className="ml-1 h-3 w-3" />
            </Link>
          </Button>
          {alert.status !== "resolved" && (
            <Button size="sm" variant="ghost" onClick={onResolve}>
              <CheckCircle className="mr-1 h-3 w-3" />
              Resolve
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
