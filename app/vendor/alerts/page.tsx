"use client"

import { useState, useCallback } from "react"
import { AlertsList } from "@/components/shared/alerts/alerts-list"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import {
  AlertTriangle,
  Clock,
  FileText,
  CheckCircle2,
} from "lucide-react"
import {
  useVendorAlerts,
  useResolveVendorAlert,
  useDismissVendorAlert,
  useBulkResolveVendorAlerts,
  useBulkDismissVendorAlerts,
} from "@/hooks/use-vendor-alerts"
type StatusTab = "all" | "active" | "resolved"

export default function VendorAlertsPage() {
  const [tab, setTab] = useState<StatusTab>("active")
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  // Fetch active alerts (new_alert + read)
  const { data: activeData, isLoading: activeLoading } = useVendorAlerts("", {})
  // Fetch resolved alerts
  const { data: resolvedData, isLoading: resolvedLoading } = useVendorAlerts("", { status: "resolved" })

  const resolve = useResolveVendorAlert()
  const dismiss = useDismissVendorAlert()
  const bulkResolve = useBulkResolveVendorAlerts()
  const bulkDismiss = useBulkDismissVendorAlerts()

  const activeAlerts = activeData?.alerts ?? []
  const resolvedAlerts = resolvedData?.alerts ?? []

  // Compute severity counts from active alerts
  const computedHighCount = activeAlerts.filter((a) => a.severity === "high").length
  const computedMediumCount = activeAlerts.filter((a) => a.severity === "medium").length
  const computedLowCount = activeAlerts.filter((a) => a.severity === "low").length

  // Pick the visible list based on tab
  const visibleAlerts = tab === "resolved" ? resolvedAlerts : tab === "active" ? activeAlerts : [...activeAlerts, ...resolvedAlerts]
  const isLoading = tab === "resolved" ? resolvedLoading : tab === "active" ? activeLoading : activeLoading || resolvedLoading

  const handleSelect = useCallback((id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }, [])

  const handleSelectAll = useCallback((checked: boolean) => {
    setSelectedIds(checked ? new Set(visibleAlerts.map((a) => a.id)) : new Set())
  }, [visibleAlerts])

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-balance">Alerts</h1>
          <p className="text-muted-foreground">
            Contract expirations, compliance issues, and action items
          </p>
        </div>
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => bulkResolve.mutate(Array.from(selectedIds))}>
              Resolve ({selectedIds.size})
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => bulkDismiss.mutate(Array.from(selectedIds))}
            >
              Dismiss ({selectedIds.size})
            </Button>
          </div>
        )}
      </div>

      {/* Alert Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-100 dark:bg-red-900/30">
                <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />
              </div>
              <div>
                <div className="text-2xl font-bold">{computedHighCount}</div>
                <div className="text-sm text-muted-foreground">High Priority</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-900/30">
                <Clock className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <div className="text-2xl font-bold">{computedMediumCount}</div>
                <div className="text-sm text-muted-foreground">Medium Priority</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-900/30">
                <FileText className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <div className="text-2xl font-bold">{computedLowCount}</div>
                <div className="text-sm text-muted-foreground">Low Priority</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-100 dark:bg-green-900/30">
                <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <div className="text-2xl font-bold">{resolvedAlerts.length}</div>
                <div className="text-sm text-muted-foreground">Resolved</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Status Tabs: Active / Resolved */}
      <Tabs value={tab} onValueChange={(v) => { setTab(v as StatusTab); setSelectedIds(new Set()) }}>
        <TabsList>
          <TabsTrigger value="active">
            Active
            <Badge variant="secondary" className="ml-2">{activeAlerts.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="resolved">
            Resolved
            <Badge variant="secondary" className="ml-2">{resolvedAlerts.length}</Badge>
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div className={tab === "resolved" ? "opacity-60" : undefined}>
        <AlertsList
          alerts={visibleAlerts}
          isLoading={isLoading}
          selectedIds={selectedIds}
          onSelect={handleSelect}
          onSelectAll={handleSelectAll}
          onResolve={(id) => resolve.mutate(id)}
          onDismiss={(id) => dismiss.mutate(id)}
          onNavigate={() => {}}
          emptyMessage={tab === "resolved" ? "Resolved alerts will appear here" : undefined}
        />
      </div>
    </div>
  )
}
