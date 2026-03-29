"use client"

import { AlertCard } from "./alert-card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Checkbox } from "@/components/ui/checkbox"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import type { Alert } from "@prisma/client"

type AlertWithRelations = Alert & {
  contract?: { id: string; name: string } | null
  vendor?: { id: string; name: string } | null
}

interface AlertsListProps {
  alerts: AlertWithRelations[]
  onResolve: (id: string) => void
  onDismiss: (id: string) => void
  onNavigate: (id: string) => void
  selectedIds: Set<string>
  onSelect: (id: string, checked: boolean) => void
  onSelectAll: (checked: boolean) => void
  isLoading: boolean
}

export function AlertsList({
  alerts, onResolve, onDismiss, onNavigate,
  selectedIds, onSelect, onSelectAll, isLoading,
}: AlertsListProps) {
  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-xl" />
        ))}
      </div>
    )
  }

  if (alerts.length === 0) {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">No alerts found.</p>
    )
  }

  const allSelected = alerts.length > 0 && alerts.every((a) => selectedIds.has(a.id))

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 px-1">
        <Checkbox checked={allSelected} onCheckedChange={onSelectAll} />
        <span className="text-sm text-muted-foreground">
          {selectedIds.size > 0 ? `${selectedIds.size} selected` : "Select all"}
        </span>
      </div>
      <ScrollArea className="h-[calc(100vh-320px)]">
        <div className="space-y-2 pr-3">
          {alerts.map((alert) => (
            <AlertCard
              key={alert.id}
              alert={alert}
              selected={selectedIds.has(alert.id)}
              onSelect={(checked) => onSelect(alert.id, checked as boolean)}
              onResolve={() => onResolve(alert.id)}
              onDismiss={() => onDismiss(alert.id)}
              onNavigate={() => onNavigate(alert.id)}
            />
          ))}
        </div>
      </ScrollArea>
    </div>
  )
}
