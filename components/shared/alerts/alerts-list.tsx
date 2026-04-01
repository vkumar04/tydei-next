"use client"

import { useState, useMemo } from "react"
import { AlertCard } from "./alert-card"
import { alertTypeIconConfig, alertSeverityBadgeConfig, statusColors } from "./alert-config"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Checkbox } from "@/components/ui/checkbox"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  BellOff,
  Search,
  CheckCircle2,
  Archive,
  SlidersHorizontal,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { formatDistanceToNow } from "date-fns"
import type { Alert } from "@prisma/client"

// ─── Types ──────────────────────────────────────────────────────

type AlertWithRelations = Alert & {
  contract?: { id: string; name: string } | null
  vendor?: { id: string; name: string } | null
}

type StatusTab = "all" | "new_alert" | "read" | "resolved"

interface AlertsListProps {
  alerts: AlertWithRelations[]
  onResolve: (id: string) => void
  onDismiss: (id: string) => void
  onNavigate: (id: string) => void
  onMarkRead?: (id: string) => void
  selectedIds: Set<string>
  onSelect: (id: string, checked: boolean) => void
  onSelectAll: (checked: boolean) => void
  onBulkResolve?: (ids: string[]) => void
  onBulkDismiss?: (ids: string[]) => void
  isLoading: boolean
  emptyMessage?: string
}

// ─── Helpers ────────────────────────────────────────────────────

const STATUS_TABS: { value: StatusTab; label: string }[] = [
  { value: "all", label: "All" },
  { value: "new_alert", label: "New" },
  { value: "read", label: "In Progress" },
  { value: "resolved", label: "Resolved" },
]

const SEVERITY_OPTIONS = [
  { value: "all", label: "All Severities" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
]

const TYPE_OPTIONS = [
  { value: "all", label: "All Types" },
  { value: "off_contract", label: "Off-Contract" },
  { value: "expiring_contract", label: "Expiring" },
  { value: "tier_threshold", label: "Tier Threshold" },
  { value: "rebate_due", label: "Rebate Due" },
  { value: "payment_due", label: "Payment Due" },
  { value: "pricing_error", label: "Pricing Error" },
  { value: "compliance", label: "Compliance" },
]

// ─── Component ──────────────────────────────────────────────────

export function AlertsList({
  alerts,
  onResolve,
  onDismiss,
  onNavigate,
  onMarkRead,
  selectedIds,
  onSelect,
  onSelectAll,
  onBulkResolve,
  onBulkDismiss,
  isLoading,
  emptyMessage,
}: AlertsListProps) {
  const [activeTab, setActiveTab] = useState<StatusTab>("all")
  const [searchQuery, setSearchQuery] = useState("")
  const [severityFilter, setSeverityFilter] = useState("all")
  const [typeFilter, setTypeFilter] = useState("all")

  // ── Counts per status ──────────────────────────────────────
  const statusCounts = useMemo(() => {
    const counts: Record<StatusTab, number> = {
      all: alerts.length,
      new_alert: 0,
      read: 0,
      resolved: 0,
    }
    for (const a of alerts) {
      if (a.status === "new_alert") counts.new_alert++
      else if (a.status === "read") counts.read++
      else if (a.status === "resolved") counts.resolved++
    }
    return counts
  }, [alerts])

  // ── Filtered alerts ────────────────────────────────────────
  const filteredAlerts = useMemo(() => {
    let result = alerts

    // Status tab filter
    if (activeTab !== "all") {
      result = result.filter((a) => a.status === activeTab)
    }

    // Search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      result = result.filter(
        (a) =>
          a.title.toLowerCase().includes(q) ||
          a.description?.toLowerCase().includes(q) ||
          a.vendor?.name.toLowerCase().includes(q) ||
          a.contract?.name.toLowerCase().includes(q)
      )
    }

    // Severity
    if (severityFilter !== "all") {
      result = result.filter((a) => a.severity === severityFilter)
    }

    // Type
    if (typeFilter !== "all") {
      result = result.filter((a) => a.alertType === typeFilter)
    }

    return result
  }, [alerts, activeTab, searchQuery, severityFilter, typeFilter])

  const allSelected =
    filteredAlerts.length > 0 &&
    filteredAlerts.every((a) => selectedIds.has(a.id))

  const someSelected = selectedIds.size > 0

  // ── Loading state ──────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-full rounded-lg" />
        <div className="flex gap-2">
          <Skeleton className="h-9 w-48 rounded-md" />
          <Skeleton className="h-9 w-36 rounded-md" />
          <Skeleton className="h-9 w-36 rounded-md" />
        </div>
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28 w-full rounded-xl" />
        ))}
      </div>
    )
  }

  // ── Empty (no alerts at all) ───────────────────────────────
  if (alerts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="rounded-full bg-muted p-4 mb-4">
          <BellOff className="h-10 w-10 text-muted-foreground/50" />
        </div>
        <h3 className="font-semibold text-lg">No alerts</h3>
        <p className="text-sm text-muted-foreground mt-1 max-w-xs">
          {emptyMessage ?? "You\u2019re all caught up! We\u2019ll notify you when something needs your attention."}
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* ── Status filter tabs with count badges ─────────────── */}
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as StatusTab)}
      >
        <TabsList>
          {STATUS_TABS.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value} className="gap-1.5">
              {tab.label}
              <Badge
                variant={activeTab === tab.value ? "default" : "secondary"}
                className={cn(
                  "ml-1 h-5 min-w-[20px] px-1.5 text-[10px] font-semibold",
                  tab.value === "new_alert" &&
                    statusCounts.new_alert > 0 &&
                    activeTab !== "new_alert" &&
                    "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300"
                )}
              >
                {statusCounts[tab.value]}
              </Badge>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/* ── Search and filter bar ────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search alerts..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>

        <Select value={severityFilter} onValueChange={setSeverityFilter}>
          <SelectTrigger className="w-[160px]">
            <SlidersHorizontal className="mr-2 h-4 w-4" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SEVERITY_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-[170px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TYPE_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* ── Bulk actions toolbar ─────────────────────────────── */}
      <div className="flex items-center gap-4 px-4 py-2 border rounded-lg bg-muted/30">
        <Checkbox
          checked={allSelected}
          onCheckedChange={(checked) => onSelectAll(checked as boolean)}
        />
        <span className="text-sm text-muted-foreground">
          {someSelected
            ? `${selectedIds.size} selected`
            : `Select all (${filteredAlerts.length})`}
        </span>

        {someSelected && (
          <div className="flex items-center gap-2 ml-auto">
            {onBulkResolve && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onBulkResolve(Array.from(selectedIds))}
              >
                <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                Resolve ({selectedIds.size})
              </Button>
            )}
            {onBulkDismiss && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onBulkDismiss(Array.from(selectedIds))}
              >
                <Archive className="mr-1.5 h-3.5 w-3.5" />
                Dismiss ({selectedIds.size})
              </Button>
            )}
          </div>
        )}
      </div>

      {/* ── Alert items ──────────────────────────────────────── */}
      {filteredAlerts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Search className="h-10 w-10 text-muted-foreground/40 mb-3" />
          <h3 className="font-semibold">No matching alerts</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Try adjusting your filters or search query.
          </p>
        </div>
      ) : (
        <ScrollArea className="h-[500px]">
          <div className="space-y-1">
            {filteredAlerts.map((alert) => (
              <AlertCard
                key={alert.id}
                alert={alert}
                selected={selectedIds.has(alert.id)}
                onSelect={(checked) => onSelect(alert.id, checked as boolean)}
                onResolve={() => onResolve(alert.id)}
                onDismiss={() => onDismiss(alert.id)}
                onNavigate={() => onNavigate(alert.id)}
              />
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  )
}
