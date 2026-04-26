"use client"

import { AlertCard } from "./alert-card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Checkbox } from "@/components/ui/checkbox"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { BellOff, Search, CheckCircle2, Archive } from "lucide-react"
import type { Alert } from "@prisma/client"

// ─── Types ──────────────────────────────────────────────────────

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
  onBulkResolve?: (ids: string[]) => void
  onBulkDismiss?: (ids: string[]) => void
  isLoading: boolean
  emptyMessage?: string
}

/**
 * Bulk-action alerts list. Filtering UI was stubbed in earlier but
 * never wired (the consumer that uses this component does its own
 * filtering upstream and just passes the already-filtered array).
 * 2026-04-26: stripped the dead state + imports.
 */
export function AlertsList({
  alerts,
  onResolve,
  onDismiss,
  onNavigate,
  selectedIds,
  onSelect,
  onSelectAll,
  onBulkResolve,
  onBulkDismiss,
  isLoading,
  emptyMessage,
}: AlertsListProps) {
  const filteredAlerts = alerts
  const allSelected =
    filteredAlerts.length > 0 &&
    filteredAlerts.every((a) => selectedIds.has(a.id))

  const someSelected = selectedIds.size > 0

  // ── Loading state ──────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-full rounded-lg" />
        <div className="flex gap-2">
          <Skeleton className="h-9 w-48 rounded-md" />
          <Skeleton className="h-9 w-36 rounded-md" />
          <Skeleton className="h-9 w-36 rounded-md" />
        </div>
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28 w-full rounded-xl" />
        ))}
      </div>
    )
  }

  // ── Empty (no alerts at all) ───────────────────────────────
  if (alerts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="rounded-full bg-muted p-4 mb-4">
          <BellOff className="h-10 w-10 text-muted-foreground/50" />
        </div>
        <h3 className="font-semibold text-lg">No alerts</h3>
        <p className="text-sm text-muted-foreground mt-1 max-w-xs">
          {emptyMessage ?? "You\u2019re all caught up! We\u2019ll notify you when something needs your attention."}
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* ── Bulk actions toolbar ─────────────────────────────── */}
      <div className="flex items-center gap-4 px-4 py-2 border rounded-lg bg-muted/30">
        <Checkbox
          checked={allSelected}
          onCheckedChange={(checked) => onSelectAll(checked as boolean)}
        />
        <span className="text-sm text-muted-foreground">
          {someSelected
            ? `${selectedIds.size} selected`
            : `Select all (${filteredAlerts.length})`}
        </span>

        {someSelected && (
          <div className="flex items-center gap-2 ml-auto">
            {onBulkResolve && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onBulkResolve(Array.from(selectedIds))}
              >
                <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                Resolve ({selectedIds.size})
              </Button>
            )}
            {onBulkDismiss && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onBulkDismiss(Array.from(selectedIds))}
              >
                <Archive className="mr-1.5 h-3.5 w-3.5" />
                Dismiss ({selectedIds.size})
              </Button>
            )}
          </div>
        )}
      </div>

      {/* ── Alert items ──────────────────────────────────────── */}
      {filteredAlerts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Search className="h-10 w-10 text-muted-foreground/40 mb-3" />
          <h3 className="font-semibold">No matching alerts</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Try adjusting your filters or search query.
          </p>
        </div>
      ) : (
        <ScrollArea className="h-[500px]">
          <div className="space-y-1">
            {filteredAlerts.map((alert) => (
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
      )}
    </div>
  )
}
