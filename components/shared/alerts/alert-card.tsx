"use client"

import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { alertTypeIconConfig, alertSeverityBadgeConfig } from "./alert-config"
import { formatDate } from "@/lib/formatting"
import { Check, X, ExternalLink } from "lucide-react"
import type { Alert } from "@prisma/client"

interface AlertCardProps {
  alert: Alert & { contract?: { id: string; name: string } | null; vendor?: { id: string; name: string } | null }
  onResolve: () => void
  onDismiss: () => void
  onNavigate: () => void
  selected?: boolean
  onSelect?: (checked: boolean) => void
}

export function AlertCard({ alert, onResolve, onDismiss, onNavigate, selected, onSelect }: AlertCardProps) {
  const typeConfig = alertTypeIconConfig[alert.alertType]
  const severityConfig = alertSeverityBadgeConfig[alert.severity]
  const Icon = typeConfig?.icon

  return (
    <Card className="transition-colors hover:bg-muted/50">
      <CardContent className="flex items-start gap-3 p-4">
        {onSelect && (
          <Checkbox checked={selected} onCheckedChange={onSelect} className="mt-1" />
        )}
        {Icon && <Icon className={`mt-0.5 size-5 shrink-0 ${typeConfig.color}`} />}
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <span className="font-medium leading-tight">{alert.title}</span>
            {severityConfig && (
              <Badge variant={severityConfig.variant} className={severityConfig.className}>
                {severityConfig.label}
              </Badge>
            )}
          </div>
          {alert.description && (
            <p className="text-sm text-muted-foreground">{alert.description}</p>
          )}
          <p className="text-xs text-muted-foreground">{formatDate(alert.createdAt)}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button variant="ghost" size="icon" onClick={onNavigate} title="View details">
            <ExternalLink className="size-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={onResolve} title="Resolve">
            <Check className="size-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={onDismiss} title="Dismiss">
            <X className="size-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
