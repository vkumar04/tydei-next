"use client"

/**
 * Facility renewals page — hero + tabs layout (2026-04-22 redesign,
 * mirrors Analysis / Rebate Optimizer). ControlBar status Select and
 * the tab strip share state so picking one updates the other.
 */

import { useMemo, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { EmptyState } from "@/components/shared/empty-state"
import { CalendarRange } from "lucide-react"
import { toast } from "sonner"
import {
  useContractPerformanceHistory,
  useExpiringContracts,
} from "@/hooks/use-renewals"
import type { ExpiringContract } from "@/lib/actions/renewals"
import { computeRenewalSummary } from "@/lib/renewals/summary-stats"
import { RenewalsHero, type RenewalsHeroStats } from "./renewals-hero"
import { RenewalsControlBar } from "./renewals-control-bar"
import type { StatusFilter } from "./renewals-filter-bar"
import { RenewalsList } from "./renewals-list"
import { RenewalDetailTabs } from "./renewal-detail-tabs"
import { RenewalAlertSettingsForm } from "./renewal-alert-settings-form"
import { toDetail, toRow, toSummaryInput } from "./renewals-mappers"

interface RenewalsClientProps {
  facilityId: string
  currentUserId: string
}

/** Threshold below which a "critical" contract counts as unstarted. */
const CRITICAL_UNSTARTED_DAYS = 14

const STATUS_TABS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "critical", label: "Critical" },
  { value: "warning", label: "Warning" },
  { value: "upcoming", label: "Upcoming" },
  { value: "ok", label: "On Track" },
]

function exportRenewalsCalendar() {
  try {
    window.location.href = "/api/renewals/export"
    toast.success("Calendar exported", {
      description: "Downloading .ics — import into your calendar app",
    })
  } catch {
    toast.error("Export failed", {
      description: "Could not generate calendar file",
    })
  }
}

export function RenewalsClient({
  facilityId,
  currentUserId,
}: RenewalsClientProps) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all")
  const [vendorFilter, setVendorFilter] = useState<string>("all")
  const [search, setSearch] = useState("")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const { data, isLoading } = useExpiringContracts(facilityId, 365, "facility")
  const contracts: ExpiringContract[] = useMemo(() => data ?? [], [data])
  const rows = useMemo(() => contracts.map(toRow), [contracts])

  const vendors = useMemo(
    () => [...new Set(rows.map((r) => r.vendorName))].sort(),
    [rows],
  )

  const counts = useMemo(() => {
    const c = { all: rows.length, critical: 0, warning: 0, upcoming: 0, ok: 0 }
    for (const r of rows) c[r.status] += 1
    return c
  }, [rows])

  const summary = useMemo(
    () => computeRenewalSummary(contracts.map(toSummaryInput)),
    [contracts],
  )

  const heroStats = useMemo<RenewalsHeroStats>(() => {
    let e30 = 0
    let e60 = 0
    let e90 = 0
    let criticalUnstarted = 0
    for (const r of rows) {
      const d = r.daysUntilExpiry
      if (d <= 30) {
        e30 += 1
        if (d <= CRITICAL_UNSTARTED_DAYS) criticalUnstarted += 1
      } else if (d <= 60) {
        e60 += 1
      } else if (d <= 90) {
        e90 += 1
      }
    }
    return {
      expiring30: e30,
      expiring60: e60,
      expiring90: e90,
      atRisk: summary.atRisk,
      totalContracts: rows.length,
      criticalUnstarted,
    }
  }, [rows, summary])

  const filteredRows = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return rows
      .filter((r) => (statusFilter === "all" ? true : r.status === statusFilter))
      .filter((r) =>
        vendorFilter === "all" ? true : r.vendorName === vendorFilter,
      )
      .filter((r) => {
        if (!needle) return true
        return (
          r.name.toLowerCase().includes(needle) ||
          r.vendorName.toLowerCase().includes(needle) ||
          (r.contractNumber?.toLowerCase().includes(needle) ?? false)
        )
      })
      .sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry)
  }, [rows, statusFilter, vendorFilter, search])

  const selectedContract = useMemo(
    () => contracts.find((c) => c.id === selectedId) ?? null,
    [contracts, selectedId],
  )
  const { data: performanceHistory } = useContractPerformanceHistory(selectedId)
  const selectedDetail = selectedContract
    ? toDetail(selectedContract, performanceHistory ?? [])
    : null

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Contract Renewals</h1>
        <p className="text-sm text-muted-foreground">
          Track upcoming renewals and plan negotiations before expiration.
        </p>
      </div>

      <RenewalsControlBar
        status={statusFilter}
        onStatusChange={setStatusFilter}
        vendors={vendors}
        vendorFilter={vendorFilter}
        onVendorFilterChange={setVendorFilter}
        search={search}
        onSearchChange={setSearch}
        onExportCalendar={exportRenewalsCalendar}
        onOpenSettings={() => setSettingsOpen(true)}
        counts={counts}
      />

      {isLoading ? (
        <Skeleton className="h-[260px] rounded-xl" />
      ) : (
        <RenewalsHero stats={heroStats} />
      )}

      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={CalendarRange}
          title="No contracts on file"
          description="Add a contract to start tracking renewals here."
        />
      ) : (
        <Tabs
          value={statusFilter}
          onValueChange={(v) => setStatusFilter(v as StatusFilter)}
          className="w-full"
        >
          <TabsList>
            {STATUS_TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>
                {t.label} ({counts[t.value]})
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value={statusFilter} className="mt-4">
            <RenewalsList
              rows={filteredRows}
              selectedId={selectedId}
              onSelect={(row) => setSelectedId(row.id)}
            />
          </TabsContent>
        </Tabs>
      )}

      <Dialog
        open={selectedDetail !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null)
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
          {selectedDetail ? (
            <>
              <DialogHeader>
                <DialogTitle>{selectedDetail.name}</DialogTitle>
                <DialogDescription>
                  {selectedDetail.vendorName}
                  {selectedDetail.contractNumber
                    ? ` • ${selectedDetail.contractNumber}`
                    : null}
                </DialogDescription>
              </DialogHeader>
              <RenewalDetailTabs
                detail={selectedDetail}
                currentUserId={currentUserId}
              />
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Renewal Alert Settings</DialogTitle>
            <DialogDescription>
              Control how and when we notify you about upcoming renewals.
            </DialogDescription>
          </DialogHeader>
          <RenewalAlertSettingsForm />
        </DialogContent>
      </Dialog>
    </div>
  )
}
