"use client"

import { AlertCard } from "./alert-card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Checkbox } from "@/components/ui/checkbox"
import { Skeleton } from "@/components/ui/skeleton"
import { BellOff } from "lucide-react"
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
  emptyMessage?: string
}

export function AlertsList({
  alerts,
  onResolve,
  onDismiss,
  onNavigate,
  selectedIds,
  onSelect,
  onSelectAll,
  isLoading,
  emptyMessage,
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
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <BellOff className="h-12 w-12 text-muted-foreground/50 mb-4" />
        <h3 className="font-semibold">No alerts</h3>
        <p className="text-sm text-muted-foreground">
          {emptyMessage ?? "You\u2019re all caught up!"}
        </p>
      </div>
    )
  }

  const allSelected = alerts.length > 0 && alerts.every((a) => selectedIds.has(a.id))

  return (
    <div className="space-y-1">
      {/* Select all checkbox */}
      <div className="flex items-center gap-4 px-4 py-2 border-b">
        <Checkbox
          checked={allSelected}
          onCheckedChange={(checked) => onSelectAll(checked as boolean)}
        />
        <span className="text-sm text-muted-foreground">
          Select all ({alerts.length})
        </span>
      </div>

      {/* Alert items */}
      <ScrollArea className="h-[500px]">
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
      </ScrollArea>
    </div>
  )
}
