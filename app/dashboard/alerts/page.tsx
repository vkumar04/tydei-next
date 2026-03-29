"use client"

import { useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import { PageHeader } from "@/components/shared/page-header"
import { AlertsList } from "@/components/shared/alerts/alerts-list"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { useAlerts, useResolveAlert, useDismissAlert, useBulkResolveAlerts, useBulkDismissAlerts } from "@/hooks/use-alerts"
import type { AlertType } from "@prisma/client"

const TABS: { label: string; value: AlertType | "all" }[] = [
  { label: "All", value: "all" },
  { label: "Off-Contract", value: "off_contract" },
  { label: "Expiring", value: "expiring_contract" },
  { label: "Tier Threshold", value: "tier_threshold" },
  { label: "Rebate Due", value: "rebate_due" },
]

export default function AlertsPage() {
  const router = useRouter()
  const [tab, setTab] = useState<AlertType | "all">("all")
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const filters = tab === "all" ? {} : { alertType: tab as AlertType }
  const { data, isLoading } = useAlerts("", filters)
  const resolve = useResolveAlert()
  const dismiss = useDismissAlert()
  const bulkResolve = useBulkResolveAlerts()
  const bulkDismiss = useBulkDismissAlerts()

  const alerts = data?.alerts ?? []

  const handleSelect = useCallback((id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }, [])

  const handleSelectAll = useCallback((checked: boolean) => {
    setSelectedIds(checked ? new Set(alerts.map((a) => a.id)) : new Set())
  }, [alerts])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Alerts"
        description="Monitor contract alerts and notifications"
        action={
          selectedIds.size > 0 ? (
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={() => bulkResolve.mutate(Array.from(selectedIds))}>
                Resolve ({selectedIds.size})
              </Button>
              <Button size="sm" variant="outline" onClick={() => bulkDismiss.mutate(Array.from(selectedIds))}>
                Dismiss ({selectedIds.size})
              </Button>
            </div>
          ) : undefined
        }
      />
      <Tabs value={tab} onValueChange={(v) => { setTab(v as AlertType | "all"); setSelectedIds(new Set()) }}>
        <TabsList>
          {TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>{t.label}</TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
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
  )
}
