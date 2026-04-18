"use client"

/**
 * Facility renewals page orchestrator.
 *
 * Thin coordinator — all heavy lifting lives in focused children:
 *   - RenewalsSummaryCards   (facility-wide rollup)
 *   - RenewalsFilterBar      (status + search)
 *   - RenewalsList           (table)
 *   - RenewalDetailTabs      (dialog tabs; pulls notes/settings itself)
 *
 * Data source is the legacy `getExpiringContracts` server action via
 * `useExpiringContracts`. We normalize its `ExpiringContract` shape into
 * the row/detail shapes each child expects and delegate status
 * classification + summary aggregation to the pure helpers in
 * lib/renewals/ (engine + summary-stats).
 */

import { useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/shared/empty-state"
import { CalendarRange, Settings2 } from "lucide-react"
import { useExpiringContracts } from "@/hooks/use-renewals"
import type { ExpiringContract } from "@/lib/actions/renewals"
import { computeRenewalSummary } from "@/lib/renewals/summary-stats"
import { RenewalsSummaryCards } from "./renewals-summary-cards"
import {
  RenewalsFilterBar,
  type StatusFilter,
} from "./renewals-filter-bar"
import { RenewalsList } from "./renewals-list"
import { RenewalDetailTabs } from "./renewal-detail-tabs"
import { RenewalAlertSettingsForm } from "./renewal-alert-settings-form"
import {
  toDetail,
  toRow,
  toSummaryInput,
} from "./renewals-mappers"

interface RenewalsClientProps {
  facilityId: string
  currentUserId: string
}

export function RenewalsClient({
  facilityId,
  currentUserId,
}: RenewalsClientProps) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all")
  const [search, setSearch] = useState("")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const { data, isLoading } = useExpiringContracts(facilityId, 365, "facility")
  const contracts: ExpiringContract[] = useMemo(() => data ?? [], [data])
  const rows = useMemo(() => contracts.map(toRow), [contracts])

  const counts = useMemo(() => {
    const c = { all: rows.length, critical: 0, warning: 0, upcoming: 0, ok: 0 }
    for (const r of rows) c[r.status] += 1
    return c
  }, [rows])

  const summary = useMemo(
    () => computeRenewalSummary(contracts.map(toSummaryInput)),
    [contracts],
  )

  const filteredRows = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return rows
      .filter((r) => (statusFilter === "all" ? true : r.status === statusFilter))
      .filter((r) => {
        if (!needle) return true
        return (
          r.name.toLowerCase().includes(needle) ||
          r.vendorName.toLowerCase().includes(needle) ||
          (r.contractNumber?.toLowerCase().includes(needle) ?? false)
        )
      })
      .sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry)
  }, [rows, statusFilter, search])

  const selectedContract = useMemo(
    () => contracts.find((c) => c.id === selectedId) ?? null,
    [contracts, selectedId],
  )
  const selectedDetail = selectedContract ? toDetail(selectedContract) : null

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Contract Renewals
          </h1>
          <p className="text-muted-foreground">
            Track upcoming renewals and plan negotiations before expiration.
          </p>
        </div>
        <Button variant="outline" onClick={() => setSettingsOpen(true)}>
          <Settings2 className="mr-2 h-4 w-4" />
          Alert Settings
        </Button>
      </div>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : (
        <RenewalsSummaryCards summary={summary} />
      )}

      <RenewalsFilterBar
        status={statusFilter}
        onStatusChange={setStatusFilter}
        search={search}
        onSearchChange={setSearch}
        counts={counts}
      />

      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={CalendarRange}
          title="No contracts on file"
          description="Add a contract to start tracking renewals here."
        />
      ) : (
        <RenewalsList
          rows={filteredRows}
          selectedId={selectedId}
          onSelect={(row) => setSelectedId(row.id)}
        />
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
