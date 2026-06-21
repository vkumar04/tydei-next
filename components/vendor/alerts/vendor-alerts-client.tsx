"use client"

import { useMemo, useState } from "react"
import { AlertTriangle, Bell, CheckCircle2 } from "lucide-react"

import { AlertsInbox } from "@/components/shared/alerts/alerts-inbox"
import type { AlertRowItem } from "@/components/shared/alerts/alerts-row"
import type { StatusFilterValue } from "@/components/shared/alerts/alerts-toolbar"
import { Badge } from "@/components/ui/badge"
import type { AlertFilters } from "@/lib/validators/alerts"
import {
  useBulkDismissVendorAlerts,
  useBulkResolveVendorAlerts,
  useDismissVendorAlert,
  useResolveVendorAlert,
  useVendorAlerts,
} from "@/hooks/use-vendor-alerts"

const PAGE_SIZE = 100

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

export function VendorAlertsClient() {
  const [statusFilter, setStatusFilter] = useState<StatusFilterValue>("open")

  // One query drives the list; `counts` is the full-population server aggregate
  // (active + resolved) regardless of the status filter, so the hero stays
  // accurate. (Audit M10.)
  const { data, isLoading } = useVendorAlerts("", {
    status: serverStatusFor(statusFilter),
    pageSize: PAGE_SIZE,
  })

  const resolve = useResolveVendorAlert()
  const dismiss = useDismissVendorAlert()
  const bulkResolve = useBulkResolveVendorAlerts()
  const bulkDismiss = useBulkDismissVendorAlerts()

  const alerts = useMemo(
    () => (data?.alerts ?? []) as AlertRowItem[],
    [data?.alerts],
  )

  const counts = data?.counts
  const highCount = counts?.bySeverity?.high ?? 0
  const mediumCount = counts?.bySeverity?.medium ?? 0
  const unresolvedCount = counts?.activeTotal ?? 0
  const resolvedCount = counts?.byStatus?.resolved ?? 0

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

      <AlertsInbox
        alerts={alerts}
        total={data?.total ?? 0}
        isLoading={isLoading}
        statusFilter={statusFilter}
        onStatusChange={setStatusFilter}
        onResolve={(id) => resolve.mutate(id)}
        onDismiss={(id) => dismiss.mutate(id)}
        onBulkResolve={(ids) => bulkResolve.mutate(ids)}
        onBulkDismiss={(ids) => bulkDismiss.mutate(ids)}
        isBulkPending={bulkResolve.isPending || bulkDismiss.isPending}
        detailHrefFor={(a) => a.actionLink ?? undefined}
      />
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
