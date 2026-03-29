"use client"

import { useState, useCallback, useMemo } from "react"
import { useRouter } from "next/navigation"
import { PageHeader } from "@/components/shared/page-header"
import { AlertsList } from "@/components/shared/alerts/alerts-list"
import { Card, CardContent } from "@/components/ui/card"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  useAlerts,
  useResolveAlert,
  useDismissAlert,
  useBulkResolveAlerts,
  useBulkDismissAlerts,
} from "@/hooks/use-alerts"
import { FileX, Clock, DollarSign, Bell, Check } from "lucide-react"
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

  return (
    <div className="space-y-6">
      <PageHeader
        title="Alerts"
        description="Notifications about contracts, purchases, and rebates"
        action={
          <div className="flex items-center gap-2">
            {selectedIds.size > 0 && (
              <>
                <Button
                  size="sm"
                  onClick={() => {
                    bulkResolve.mutate(Array.from(selectedIds))
                    setSelectedIds(new Set())
                  }}
                >
                  Resolve ({selectedIds.size})
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    bulkDismiss.mutate(Array.from(selectedIds))
                    setSelectedIds(new Set())
                  }}
                >
                  Dismiss ({selectedIds.size})
                </Button>
              </>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const unreadIds = allAlerts
                  .filter((a) => a.status === "new_alert")
                  .map((a) => a.id)
                if (unreadIds.length > 0) bulkResolve.mutate(unreadIds)
              }}
            >
              <Check className="mr-2 h-4 w-4" />
              Mark All Read
            </Button>
          </div>
        }
      />

      {/* Summary stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="border-l-4 border-l-red-500">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Off-Contract Alerts</p>
                <p className="text-2xl font-bold">{offContractCount}</p>
              </div>
              <FileX className="h-8 w-8 opacity-50 text-red-500" />
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
              <Clock className="h-8 w-8 opacity-50 text-yellow-500" />
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
              <DollarSign className="h-8 w-8 opacity-50 text-green-500" />
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
              <Bell className="h-8 w-8 opacity-50 text-blue-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs + alert list */}
      <Card>
        <Tabs
          value={tab}
          onValueChange={(v) => {
            setTab(v as TabValue)
            setSelectedIds(new Set())
          }}
        >
          <div className="border-b px-4 pt-4">
            <TabsList>
              {TABS.map((t) => (
                <TabsTrigger key={t.value} value={t.value}>
                  {t.label}
                  {t.value === "unread" && unreadCount > 0 && (
                    <Badge variant="secondary" className="ml-1.5">
                      {unreadCount}
                    </Badge>
                  )}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
          <div className="p-4">
            <AlertsList
              alerts={alerts}
              isLoading={isLoading}
              selectedIds={selectedIds}
              onSelect={handleSelect}
              onSelectAll={handleSelectAll}
              onResolve={(id) => resolve.mutate(id)}
              onDismiss={(id) => dismiss.mutate(id)}
              onNavigate={(id) => router.push(`/dashboard/alerts/${id}`)}
            />
          </div>
        </Tabs>
      </Card>
    </div>
  )
}
