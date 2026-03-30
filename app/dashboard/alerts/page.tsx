"use client"

import { useState, useCallback, useMemo } from "react"
import { useRouter } from "next/navigation"
import { AlertsList } from "@/components/shared/alerts/alerts-list"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  useAlerts,
  useResolveAlert,
  useDismissAlert,
  useMarkAlertRead,
  useBulkResolveAlerts,
  useBulkDismissAlerts,
} from "@/hooks/use-alerts"
import { FileX, Clock, DollarSign, Bell, Check, X } from "lucide-react"
import type { AlertType } from "@prisma/client"

type TabValue = AlertType | "all" | "unread"

const TABS: { label: string; value: TabValue }[] = [
  { label: "All", value: "all" },
  { label: "Unread", value: "unread" },
  { label: "Off-Contract", value: "off_contract" },
  { label: "Expiring", value: "expiring_contract" },
  { label: "Rebates", value: "rebate_due" },
]

export default function AlertsPage() {
  const router = useRouter()
  const [tab, setTab] = useState<TabValue>("all")
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  // Build server-side filters based on tab (for type-specific tabs)
  const filters: Partial<{ alertType: AlertType; status: "new_alert" | "read" }> = {}
  if (tab === "unread") {
    filters.status = "new_alert"
  } else if (tab !== "all") {
    filters.alertType = tab as AlertType
  }

  const { data, isLoading } = useAlerts("", filters)
  // Fetch all alerts (no type filter) for summary cards
  const { data: allData } = useAlerts("", {})

  const resolve = useResolveAlert()
  const dismiss = useDismissAlert()
  const markRead = useMarkAlertRead()
  const bulkResolve = useBulkResolveAlerts()
  const bulkDismiss = useBulkDismissAlerts()

  const alerts = data?.alerts ?? []
  const allAlerts = allData?.alerts ?? []

  // Summary counts from the full (unfiltered) alert list
  const offContractCount = useMemo(
    () => allAlerts.filter((a) => a.alertType === "off_contract").length,
    [allAlerts],
  )
  const expiringCount = useMemo(
    () => allAlerts.filter((a) => a.alertType === "expiring_contract").length,
    [allAlerts],
  )
  const rebatesDueCount = useMemo(
    () => allAlerts.filter((a) => a.alertType === "rebate_due").length,
    [allAlerts],
  )
  const unreadCount = useMemo(
    () => allAlerts.filter((a) => a.status === "new_alert").length,
    [allAlerts],
  )
  const totalUnresolved = allAlerts.length

  const handleSelect = useCallback((id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }, [])

  const handleSelectAll = useCallback(
    (checked: boolean) => {
      setSelectedIds(checked ? new Set(alerts.map((a) => a.id)) : new Set())
    },
    [alerts],
  )

  const handleMarkAllRead = useCallback(() => {
    const unreadIds = allAlerts
      .filter((a) => a.status === "new_alert")
      .map((a) => a.id)
    if (unreadIds.length > 0) bulkResolve.mutate(unreadIds)
  }, [allAlerts, bulkResolve])

  const handleBulkMarkRead = useCallback(() => {
    Array.from(selectedIds).forEach((id) => markRead.mutate(id))
    setSelectedIds(new Set())
  }, [selectedIds, markRead])

  const handleBulkResolve = useCallback(() => {
    bulkResolve.mutate(Array.from(selectedIds))
    setSelectedIds(new Set())
  }, [selectedIds, bulkResolve])

  const handleBulkDismiss = useCallback(() => {
    bulkDismiss.mutate(Array.from(selectedIds))
    setSelectedIds(new Set())
  }, [selectedIds, bulkDismiss])

  return (
    <div className="flex flex-col gap-6">
      {/* Page header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-balance flex items-center gap-2">
            Alerts
            {unreadCount > 0 && (
              <Badge className="bg-destructive text-destructive-foreground">
                {unreadCount} new
              </Badge>
            )}
          </h1>
          <p className="text-muted-foreground">
            Notifications about contracts, purchases, and rebates
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleMarkAllRead}>
            <Check className="mr-2 h-4 w-4" />
            Mark All Read
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-4">
        <Card className="border-l-4 border-l-red-500">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Off-Contract Alerts</p>
                <p className="text-2xl font-bold">{offContractCount}</p>
              </div>
              <FileX className="h-8 w-8 text-red-500/50" />
            </div>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-yellow-500">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Expiring Contracts</p>
                <p className="text-2xl font-bold">{expiringCount}</p>
              </div>
              <Clock className="h-8 w-8 text-yellow-500/50" />
            </div>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-green-500">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Rebates Due</p>
                <p className="text-2xl font-bold">{rebatesDueCount}</p>
              </div>
              <DollarSign className="h-8 w-8 text-green-500/50" />
            </div>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-blue-500">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Unresolved</p>
                <p className="text-2xl font-bold">{totalUnresolved}</p>
              </div>
              <Bell className="h-8 w-8 text-blue-500/50" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Alerts list */}
      <Card>
        <Tabs
          value={tab}
          onValueChange={(v) => {
            setTab(v as TabValue)
            setSelectedIds(new Set())
          }}
        >
          <CardHeader className="pb-0">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <TabsList>
                {TABS.map((t) => (
                  <TabsTrigger key={t.value} value={t.value}>
                    {t.label}
                    {t.value === "unread" && unreadCount > 0 && (
                      <Badge variant="secondary" className="ml-1">
                        {unreadCount}
                      </Badge>
                    )}
                  </TabsTrigger>
                ))}
              </TabsList>

              {selectedIds.size > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">
                    {selectedIds.size} selected
                  </span>
                  <Button size="sm" variant="outline" onClick={handleBulkMarkRead}>
                    Mark Read
                  </Button>
                  <Button size="sm" variant="outline" onClick={handleBulkResolve}>
                    Resolve
                  </Button>
                  <Button size="sm" variant="ghost" onClick={handleBulkDismiss}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>
          </CardHeader>

          <CardContent className="pt-4">
            <AlertsList
              alerts={alerts}
              isLoading={isLoading}
              selectedIds={selectedIds}
              onSelect={handleSelect}
              onSelectAll={handleSelectAll}
              onResolve={(id) => resolve.mutate(id)}
              onDismiss={(id) => dismiss.mutate(id)}
              onNavigate={(id) => router.push(`/dashboard/alerts/${id}`)}
              emptyMessage={
                tab === "all"
                  ? "You\u2019re all caught up!"
                  : "No alerts in this category"
              }
            />
          </CardContent>
        </Tabs>
      </Card>
    </div>
  )
}
