"use client"

import { useState, useCallback } from "react"
import { PageHeader } from "@/components/shared/page-header"
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
import type { AlertSeverity } from "@prisma/client"

const SEVERITY_TABS: { label: string; value: AlertSeverity | "all" }[] = [
  { label: "All", value: "all" },
  { label: "High", value: "high" },
  { label: "Medium", value: "medium" },
  { label: "Low", value: "low" },
]

export default function VendorAlertsPage() {
  const [tab, setTab] = useState<AlertSeverity | "all">("all")
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const filters = tab === "all" ? {} : { severity: tab as AlertSeverity }
  const { data, isLoading } = useVendorAlerts("", filters)
  const resolve = useResolveVendorAlert()
  const dismiss = useDismissVendorAlert()
  const bulkResolve = useBulkResolveVendorAlerts()
  const bulkDismiss = useBulkDismissVendorAlerts()

  const alerts = data?.alerts ?? []

  // Always fetch unfiltered alerts for summary counts
  const { data: allData } = useVendorAlerts("", {})
  const allAlerts = allData?.alerts ?? []
  const computedHighCount = allAlerts.filter((a) => a.severity === "high").length
  const computedMediumCount = allAlerts.filter((a) => a.severity === "medium").length
  const computedLowCount = allAlerts.filter((a) => a.severity === "low").length

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
        description="Contract expirations, compliance issues, and action items"
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
                <div className="text-2xl font-bold">{allAlerts.length}</div>
                <div className="text-sm text-muted-foreground">Total Active</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Severity Tabs */}
      <Tabs value={tab} onValueChange={(v) => { setTab(v as AlertSeverity | "all"); setSelectedIds(new Set()) }}>
        <TabsList>
          {SEVERITY_TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              {t.label}
              {t.value !== "all" && (
                <Badge variant="secondary" className="ml-2">
                  {t.value === "high" ? computedHighCount : t.value === "medium" ? computedMediumCount : computedLowCount}
                </Badge>
              )}
            </TabsTrigger>
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
        onNavigate={() => {}}
      />
    </div>
  )
}
