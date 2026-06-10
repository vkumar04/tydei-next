"use client"

import { useCallback, useMemo, useState } from "react"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs } from "@/components/ui/tabs"
import {
  useAlerts,
  useBulkUpdateAlerts,
  useMarkAllAlertsRead,
  useResolveAlert,
} from "@/hooks/use-alerts"
import type { AlertFilters } from "@/lib/validators/alerts"

import { AlertsHero } from "./alerts-hero"
import {
  AlertsListFilters,
  type AlertsTabValue,
} from "./alerts-list-filters"
import { AlertsBulkActions } from "./alerts-bulk-actions"
import { AlertsRow, type AlertRowItem } from "./alerts-row"
import { AlertsListLoading, AlertsListEmpty } from "./alerts-list-states"

interface AlertsListClientProps {
  facilityId: string
}

const TAB_TO_FILTER: Record<
  AlertsTabValue,
  Partial<Pick<AlertFilters, "alertType" | "status">>
> = {
  all: {},
  unread: { status: "new_alert" },
  off_contract: { alertType: "off_contract" },
  expiring: { alertType: "expiring_contract" },
  rebates: { alertType: "rebate_due" },
}

const PAGE_SIZE = 20

export function AlertsListClient({ facilityId }: AlertsListClientProps) {
  const router = useRouter()
  const [tab, setTab] = useState<AlertsTabValue>("all")
  const [page, setPage] = useState(1)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const { data, isLoading } = useAlerts(facilityId, {
    ...TAB_TO_FILTER[tab],
    page,
    pageSize: PAGE_SIZE,
  })

  const resolve = useResolveAlert()
  const bulkUpdate = useBulkUpdateAlerts()
  const markAllRead = useMarkAllAlertsRead()

  const alerts = (data?.alerts ?? []) as AlertRowItem[]
  const total = data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))

  // Audit M10: hero numbers come from the server-side groupBy aggregate
  // (`counts`), NOT from reducing the currently-loaded page — the old
  // client-side reducer silently capped every hero stat at the first 20
  // rows.
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

  const handleSelect = useCallback((id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }, [])

  const allFilteredSelected =
    alerts.length > 0 && alerts.every((a) => selectedIds.has(a.id))

  const handleToggleSelectAll = useCallback(() => {
    setSelectedIds((prev) => {
      const all = alerts.length > 0 && alerts.every((a) => prev.has(a.id))
      return all ? new Set() : new Set(alerts.map((a) => a.id))
    })
  }, [alerts])

  const runBulk = useCallback(
    (action: "mark_read" | "resolve" | "dismiss") => {
      bulkUpdate.mutate(
        { alertIds: Array.from(selectedIds), action },
        { onSuccess: () => setSelectedIds(new Set()) },
      )
    },
    [bulkUpdate, selectedIds],
  )

  const handleTabChange = useCallback((value: string) => {
    setTab(value as AlertsTabValue)
    setPage(1)
    setSelectedIds(new Set())
  }, [])

  const emptyMessage =
    tab === "all"
      ? "You’re all caught up! We’ll notify you when something needs your attention."
      : "No alerts in this category."

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
        <Tabs value={tab} onValueChange={handleTabChange}>
          <CardHeader className="pb-0">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <AlertsListFilters unreadCount={summary.unread} />
              <AlertsBulkActions
                selectedCount={selectedIds.size}
                isPending={bulkUpdate.isPending}
                onMarkRead={() => runBulk("mark_read")}
                onResolve={() => runBulk("resolve")}
                onDismiss={() => runBulk("dismiss")}
              />
            </div>
          </CardHeader>

          <CardContent className="pt-4">
            {isLoading ? (
              <AlertsListLoading />
            ) : alerts.length === 0 ? (
              <AlertsListEmpty message={emptyMessage} />
            ) : (
              <>
                <div className="flex items-center gap-3 px-4 py-2 border rounded-lg bg-muted/30 mb-2">
                  <Checkbox
                    checked={allFilteredSelected}
                    onCheckedChange={handleToggleSelectAll}
                    aria-label="Select all alerts"
                  />
                  <span className="text-sm text-muted-foreground">
                    {selectedIds.size > 0
                      ? `${selectedIds.size} selected`
                      : `Select all (${alerts.length})`}
                  </span>
                </div>
                <ScrollArea className="h-[500px] rounded-md border">
                  {alerts.map((alert) => (
                    <AlertsRow
                      key={alert.id}
                      alert={alert}
                      selected={selectedIds.has(alert.id)}
                      onSelect={(checked) => handleSelect(alert.id, checked)}
                      onResolve={() => resolve.mutate(alert.id)}
                      onNavigate={() =>
                        router.push(`/dashboard/alerts/${alert.id}`)
                      }
                    />
                  ))}
                </ScrollArea>
                {/* Audit M10: rows past the first 20 used to be unreachable. */}
                {pageCount > 1 ? (
                  <div className="mt-3 flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">
                      Page {page} of {pageCount} · {total} alert
                      {total === 1 ? "" : "s"}
                    </span>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={page <= 1}
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                      >
                        Previous
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={page >= pageCount}
                        onClick={() =>
                          setPage((p) => Math.min(pageCount, p + 1))
                        }
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                ) : null}
              </>
            )}
          </CardContent>
        </Tabs>
      </Card>
    </div>
  )
}
