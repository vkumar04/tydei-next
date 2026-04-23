"use client"

import { useCallback, useState } from "react"
import { AlertTriangle, Bell, CheckCircle2 } from "lucide-react"

import { AlertsList } from "@/components/shared/alerts/alerts-list"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  useBulkDismissVendorAlerts,
  useBulkResolveVendorAlerts,
  useDismissVendorAlert,
  useResolveVendorAlert,
  useVendorAlerts,
} from "@/hooks/use-vendor-alerts"

type StatusTab = "all" | "active" | "resolved"

export function VendorAlertsClient() {
  const [tab, setTab] = useState<StatusTab>("active")
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const { data: activeData, isLoading: activeLoading } = useVendorAlerts("", {})
  const { data: resolvedData, isLoading: resolvedLoading } = useVendorAlerts("", {
    status: "resolved",
  })

  const resolve = useResolveVendorAlert()
  const dismiss = useDismissVendorAlert()
  const bulkResolve = useBulkResolveVendorAlerts()
  const bulkDismiss = useBulkDismissVendorAlerts()

  const activeAlerts = activeData?.alerts ?? []
  const resolvedAlerts = resolvedData?.alerts ?? []

  const highCount = activeAlerts.filter((a) => a.severity === "high").length
  const mediumCount = activeAlerts.filter((a) => a.severity === "medium").length
  const unresolvedCount = activeAlerts.length
  const resolvedCount = resolvedAlerts.length

  const visibleAlerts =
    tab === "resolved"
      ? resolvedAlerts
      : tab === "active"
        ? activeAlerts
        : [...activeAlerts, ...resolvedAlerts]
  const isLoading =
    tab === "resolved"
      ? resolvedLoading
      : tab === "active"
        ? activeLoading
        : activeLoading || resolvedLoading

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
      setSelectedIds(checked ? new Set(visibleAlerts.map((a) => a.id)) : new Set())
    },
    [visibleAlerts],
  )

  const hasCritical = highCount > 0
  const hasAny = unresolvedCount > 0
  const headline = hasAny
    ? `${unresolvedCount} unresolved${hasCritical ? ` · ${highCount} high priority` : ""}`
    : "You're all caught up"

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-xl border bg-card p-6 shadow-sm sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
              <Bell className="h-3.5 w-3.5" />
              Alerts
            </div>
            <h2 className="text-balance text-xl font-semibold leading-tight sm:text-2xl">
              {headline}
            </h2>
            <p className="text-sm text-muted-foreground">
              Contract expirations, compliance issues, and action items
            </p>
          </div>
          {hasAny ? (
            <Badge
              variant="secondary"
              className={
                hasCritical
                  ? "gap-1.5 bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-100"
                  : "gap-1.5 bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100"
              }
            >
              <Bell className="h-3.5 w-3.5" />
              {hasCritical ? "Action needed" : "Review pending"}
            </Badge>
          ) : (
            <Badge
              variant="secondary"
              className="gap-1.5 bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              All clear
            </Badge>
          )}
        </div>

        <div className="mt-8 grid gap-6 border-y py-6 sm:grid-cols-2 lg:grid-cols-4">
          <HeroStat
            label="Unresolved"
            value={String(unresolvedCount)}
            sublabel="Active alerts"
            tone={unresolvedCount > 0 ? "warning" : "muted"}
          />
          <HeroStat
            label="High Priority"
            value={String(highCount)}
            sublabel="Need action"
            tone={highCount > 0 ? "negative" : "muted"}
            icon={<AlertTriangle className="h-4 w-4" />}
          />
          <HeroStat
            label="Medium Priority"
            value={String(mediumCount)}
            sublabel="Review soon"
            tone={mediumCount > 0 ? "warning" : "muted"}
          />
          <HeroStat
            label="Resolved"
            value={String(resolvedCount)}
            sublabel="Completed"
            tone={resolvedCount > 0 ? "positive" : "muted"}
            icon={<CheckCircle2 className="h-4 w-4" />}
          />
        </div>
      </section>

      {selectedIds.size > 0 && (
        <div className="flex items-center justify-between rounded-lg border bg-muted/40 px-4 py-3">
          <span className="text-sm text-muted-foreground">
            {selectedIds.size} selected
          </span>
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
        </div>
      )}

      <Tabs
        value={tab}
        onValueChange={(v) => {
          setTab(v as StatusTab)
          setSelectedIds(new Set())
        }}
      >
        <TabsList>
          <TabsTrigger value="all">
            All
            <Badge variant="secondary" className="ml-2">
              {activeAlerts.length + resolvedAlerts.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="active">
            Active
            <Badge variant="secondary" className="ml-2">
              {activeAlerts.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="resolved">
            Resolved
            <Badge variant="secondary" className="ml-2">
              {resolvedAlerts.length}
            </Badge>
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

interface HeroStatProps {
  label: string
  value: string
  sublabel: string
  tone?: "positive" | "negative" | "warning" | "muted"
  icon?: React.ReactNode
}

function HeroStat({ label, value, sublabel, tone, icon }: HeroStatProps) {
  const valueClass =
    tone === "positive"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "negative"
        ? "text-red-600 dark:text-red-400"
        : tone === "warning"
          ? "text-amber-600 dark:text-amber-400"
          : ""
  const sublabelClass =
    tone === "positive"
      ? "text-emerald-700 dark:text-emerald-400"
      : tone === "negative"
        ? "text-red-700 dark:text-red-400"
        : tone === "warning"
          ? "text-amber-700 dark:text-amber-400"
          : "text-muted-foreground"
  return (
    <div className="space-y-1">
      <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
        {icon}
        {label}
      </p>
      <p className={`text-3xl font-semibold tabular-nums tracking-tight sm:text-4xl ${valueClass}`}>
        {value}
      </p>
      <p className={`text-xs ${sublabelClass}`}>{sublabel}</p>
    </div>
  )
}
