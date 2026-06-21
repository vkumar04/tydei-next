"use client"

/**
 * Shared Alerts INBOX body — the toolbar + bulk-action bar + severity-grouped,
 * collapsible list + empty states. Portal-agnostic: both the facility
 * (`alerts-list-client`) and vendor (`vendor-alerts-client`) pages render this
 * with their own hero + data hooks, so the inbox UX never drifts between them.
 *
 * The inbox OWNS the client-side view state (search / type / severity /
 * selection); the PARENT owns `statusFilter` (it drives the server query) and
 * supplies the row + bulk action callbacks. `onBulkMarkRead` / `onNavigate` /
 * `detailHrefFor` are optional so the vendor portal (no mark-read, no alert
 * detail route) can omit them.
 */

import { useCallback, useMemo, useState } from "react"
import { CheckCircle2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"

import { AlertsRow, type AlertRowItem } from "./alerts-row"
import { AlertsSeverityGroup } from "./alerts-severity-group"
import {
  AlertsToolbar,
  type SeverityFilterValue,
  type StatusFilterValue,
} from "./alerts-toolbar"
import { AlertsListLoading } from "./alerts-list-states"

const SEVERITY_ORDER: Array<"high" | "medium" | "low"> = ["high", "medium", "low"]

export interface AlertsInboxProps {
  alerts: AlertRowItem[]
  total: number
  isLoading: boolean
  statusFilter: StatusFilterValue
  onStatusChange: (status: StatusFilterValue) => void
  onResolve: (id: string) => void
  onDismiss: (id: string) => void
  onBulkResolve: (ids: string[]) => void
  onBulkDismiss: (ids: string[]) => void
  /** Facility only — vendor side has no mark-read action. */
  onBulkMarkRead?: (ids: string[]) => void
  isBulkPending?: boolean
  /** Title-click navigation (omit for portals without a detail page). */
  onNavigate?: (id: string) => void
  /** "View" link target per alert (omit → no View link). */
  detailHrefFor?: (alert: AlertRowItem) => string | undefined
}

export function AlertsInbox({
  alerts,
  total,
  isLoading,
  statusFilter,
  onStatusChange,
  onResolve,
  onDismiss,
  onBulkResolve,
  onBulkDismiss,
  onBulkMarkRead,
  isBulkPending,
  onNavigate,
  detailHrefFor,
}: AlertsInboxProps) {
  const [search, setSearch] = useState("")
  const [typeFilter, setTypeFilter] = useState<string>("all")
  const [severityFilter, setSeverityFilter] = useState<SeverityFilterValue>("all")
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const availableTypes = useMemo(() => {
    const set = new Set<string>()
    for (const a of alerts) set.add(a.alertType)
    return Array.from(set).sort()
  }, [alerts])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return alerts.filter((a) => {
      if (typeFilter !== "all" && a.alertType !== typeFilter) return false
      if (severityFilter !== "all" && a.severity !== severityFilter) return false
      if (q) {
        const haystack = [
          a.title,
          a.description ?? "",
          a.vendor?.name ?? "",
          a.contract?.name ?? "",
        ]
          .join(" ")
          .toLowerCase()
        if (!haystack.includes(q)) return false
      }
      return true
    })
  }, [alerts, search, typeFilter, severityFilter])

  const grouped = useMemo(() => {
    const map: Record<"high" | "medium" | "low", AlertRowItem[]> = {
      high: [],
      medium: [],
      low: [],
    }
    for (const a of filtered) {
      const sev = (a.severity as "high" | "medium" | "low") ?? "low"
      if (map[sev]) map[sev].push(a)
      else map.low.push(a)
    }
    return map
  }, [filtered])

  const handleSelect = useCallback((id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }, [])

  const allFilteredSelected =
    filtered.length > 0 && filtered.every((a) => selectedIds.has(a.id))

  const handleToggleSelectAll = useCallback(() => {
    setSelectedIds((prev) => {
      const all = filtered.length > 0 && filtered.every((a) => prev.has(a.id))
      return all ? new Set() : new Set(filtered.map((a) => a.id))
    })
  }, [filtered])

  const clearSelection = useCallback(() => setSelectedIds(new Set()), [])

  const runBulk = useCallback(
    (fn: (ids: string[]) => void) => {
      fn(Array.from(selectedIds))
      clearSelection()
    },
    [selectedIds, clearSelection],
  )

  const hasFilters =
    search.trim() !== "" || typeFilter !== "all" || severityFilter !== "all"

  return (
    <Card>
      <CardHeader className="gap-3 pb-0">
        <AlertsToolbar
          search={search}
          onSearchChange={setSearch}
          typeFilter={typeFilter}
          onTypeChange={setTypeFilter}
          severityFilter={severityFilter}
          onSeverityChange={setSeverityFilter}
          statusFilter={statusFilter}
          onStatusChange={onStatusChange}
          availableTypes={availableTypes}
        />

        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <Checkbox
              checked={allFilteredSelected}
              onCheckedChange={handleToggleSelectAll}
              aria-label="Select all alerts"
              disabled={filtered.length === 0}
            />
            {selectedIds.size > 0
              ? `${selectedIds.size} selected`
              : `Select all (${filtered.length})`}
          </label>

          {selectedIds.size > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <Separator orientation="vertical" className="h-4" />
              <Button
                size="sm"
                variant="outline"
                disabled={isBulkPending}
                onClick={() => runBulk(onBulkResolve)}
              >
                Resolve
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={isBulkPending}
                onClick={() => runBulk(onBulkDismiss)}
              >
                Dismiss
              </Button>
              {onBulkMarkRead ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={isBulkPending}
                  onClick={() => runBulk(onBulkMarkRead)}
                >
                  Mark read
                </Button>
              ) : null}
              <Button size="sm" variant="ghost" onClick={clearSelection}>
                Clear
              </Button>
            </div>
          ) : null}
        </div>
      </CardHeader>

      <CardContent className="pt-4">
        {isLoading ? (
          <AlertsListLoading />
        ) : filtered.length === 0 ? (
          <EmptyState allClear={statusFilter === "open" && !hasFilters} />
        ) : (
          <>
            <ScrollArea className="h-[560px] overflow-hidden rounded-md border">
              {SEVERITY_ORDER.map((sev) =>
                grouped[sev].length > 0 ? (
                  <AlertsSeverityGroup
                    key={sev}
                    severity={sev}
                    count={grouped[sev].length}
                    defaultOpen
                  >
                    {grouped[sev].map((a) => (
                      <AlertsRow
                        key={a.id}
                        alert={a}
                        selected={selectedIds.has(a.id)}
                        onSelect={(checked) => handleSelect(a.id, checked)}
                        onResolve={() => onResolve(a.id)}
                        onDismiss={() => onDismiss(a.id)}
                        onNavigate={
                          onNavigate ? () => onNavigate(a.id) : undefined
                        }
                        detailHref={detailHrefFor?.(a)}
                      />
                    ))}
                  </AlertsSeverityGroup>
                ) : null,
              )}
            </ScrollArea>

            {total > alerts.length ? (
              <p className="mt-3 text-xs text-muted-foreground">
                Showing first {alerts.length} of {total} alerts.
              </p>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  )
}

function EmptyState({ allClear }: { allClear: boolean }) {
  if (allClear) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="mb-4 rounded-full bg-emerald-50 p-4 dark:bg-emerald-950">
          <CheckCircle2 className="h-10 w-10 text-emerald-600 dark:text-emerald-400" />
        </div>
        <h3 className="text-lg font-semibold">All clear</h3>
        <p className="mt-1 max-w-xs text-sm text-muted-foreground">
          You&apos;re all caught up. We&apos;ll notify you when something needs
          your attention.
        </p>
      </div>
    )
  }
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <h3 className="text-lg font-semibold">No alerts match your filters.</h3>
      <p className="mt-1 max-w-xs text-sm text-muted-foreground">
        Try clearing the search or widening the type, severity, or status
        filters.
      </p>
    </div>
  )
}
