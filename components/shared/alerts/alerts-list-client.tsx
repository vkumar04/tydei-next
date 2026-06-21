"use client"

import { useCallback, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { CheckCircle2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import {
  useAlerts,
  useBulkUpdateAlerts,
  useDismissAlert,
  useMarkAllAlertsRead,
  useResolveAlert,
} from "@/hooks/use-alerts"
import type { AlertFilters } from "@/lib/validators/alerts"

import { AlertsHero } from "./alerts-hero"
import { AlertsRow, type AlertRowItem } from "./alerts-row"
import { AlertsSeverityGroup } from "./alerts-severity-group"
import {
  AlertsToolbar,
  type SeverityFilterValue,
  type StatusFilterValue,
} from "./alerts-toolbar"
import { AlertsListLoading } from "./alerts-list-states"

interface AlertsListClientProps {
  facilityId: string
}

const PAGE_SIZE = 100

const SEVERITY_ORDER: Array<"high" | "medium" | "low"> = [
  "high",
  "medium",
  "low",
]

function serverStatusFor(
  status: StatusFilterValue,
): AlertFilters["status"] | undefined {
  switch (status) {
    case "resolved":
      return "resolved"
    case "dismissed":
      return "dismissed"
    case "open":
    case "all":
    default:
      return undefined
  }
}

export function AlertsListClient({ facilityId }: AlertsListClientProps) {
  const router = useRouter()

  const [search, setSearch] = useState("")
  const [typeFilter, setTypeFilter] = useState<string>("all")
  const [severityFilter, setSeverityFilter] =
    useState<SeverityFilterValue>("all")
  const [statusFilter, setStatusFilter] = useState<StatusFilterValue>("open")
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const { data, isLoading } = useAlerts(facilityId, {
    status: serverStatusFor(statusFilter),
    pageSize: PAGE_SIZE,
  })

  const resolve = useResolveAlert()
  const dismiss = useDismissAlert()
  const bulkUpdate = useBulkUpdateAlerts()
  const markAllRead = useMarkAllAlertsRead()

  const alerts = useMemo(
    () => (data?.alerts ?? []) as AlertRowItem[],
    [data?.alerts],
  )
  const total = data?.total ?? 0

  // The type dropdown only offers types that are actually present in the
  // current result set, sorted for stable ordering.
  const availableTypes = useMemo(() => {
    const set = new Set<string>()
    for (const a of alerts) set.add(a.alertType)
    return Array.from(set).sort()
  }, [alerts])

  const summary = useMemo(() => {
    const counts = data?.counts
    return {
      offContract: counts?.byType?.off_contract ?? 0,
      expiring: counts?.byType?.expiring_contract ?? 0,
      rebates: counts?.byType?.rebate_due ?? 0,
      unread: counts?.unread ?? 0,
      total: counts?.activeTotal ?? 0,
    }
  }, [data?.counts])

  // Client-side filtering: search (title/description/vendor/contract),
  // type, severity. (Status is applied server-side via the query above.)
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return alerts.filter((a) => {
      if (typeFilter !== "all" && a.alertType !== typeFilter) return false
      if (severityFilter !== "all" && a.severity !== severityFilter)
        return false
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

  const runBulk = useCallback(
    (action: "mark_read" | "resolve" | "dismiss") => {
      bulkUpdate.mutate(
        { alertIds: Array.from(selectedIds), action },
        { onSuccess: () => setSelectedIds(new Set()) },
      )
    },
    [bulkUpdate, selectedIds],
  )

  const hasFilters =
    search.trim() !== "" || typeFilter !== "all" || severityFilter !== "all"

  return (
    <div className="flex flex-col gap-6">
      <AlertsHero
        offContractCount={summary.offContract}
        expiringCount={summary.expiring}
        rebatesDueCount={summary.rebates}
        totalUnresolved={summary.total}
        unreadCount={summary.unread}
        onMarkAllRead={() => markAllRead.mutate()}
        isMarkingAllRead={markAllRead.isPending}
      />

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
            onStatusChange={setStatusFilter}
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
                  disabled={bulkUpdate.isPending}
                  onClick={() => runBulk("resolve")}
                >
                  Resolve
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={bulkUpdate.isPending}
                  onClick={() => runBulk("dismiss")}
                >
                  Dismiss
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={bulkUpdate.isPending}
                  onClick={() => runBulk("mark_read")}
                >
                  Mark read
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setSelectedIds(new Set())}
                >
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
            <EmptyState
              allClear={statusFilter === "open" && !hasFilters}
            />
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
                          onResolve={() => resolve.mutate(a.id)}
                          onDismiss={() => dismiss.mutate(a.id)}
                          onNavigate={() =>
                            router.push(`/dashboard/alerts/${a.id}`)
                          }
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
    </div>
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
