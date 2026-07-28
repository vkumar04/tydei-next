"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter, useSearchParams, usePathname } from "next/navigation"
import Link from "next/link"
import {
  ArrowLeftRight,
  FileText,
  Inbox,
  Plus,
} from "lucide-react"
import { toast } from "sonner"
import type { ContractStatus, ContractType } from "@/lib/generated/prisma/client"
import {
  fetchContractsForExport,
  summarizeContractsExport,
  useContracts,
  useContractStats,
  useDeleteContract,
} from "@/hooks/use-contracts"
import { useFacilityPendingContracts } from "@/hooks/use-pending-contracts"
import { filterAwaitingReview } from "@/lib/contracts/pending-awaiting-review"
import { getContractColumns } from "@/components/contracts/contract-columns"
import { DataTable } from "@/components/shared/tables/data-table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { PendingContractsTab } from "@/components/facility/contracts/pending-contracts-tab"
import { CompareModal } from "./compare-modal"
import type { CompareContract } from "./compare-row-builder"
import { buildContractsCSV } from "./contract-export"
import { ContractsHero } from "./contracts-hero"
import { ContractsControlBar } from "./contracts-control-bar"
import { CompareTab } from "./contracts-compare-tab"
import type { FacilityScope } from "@/lib/actions/contracts-auth"

/**
 * Contracts list page — 2026-04-22 hero + tabbed-details redesign.
 *
 * Previous layout stacked: header, 5-card KPI grid, 1-card secondary row,
 * outer Tabs (Contracts/Pending/Compare), inner Tabs (scope), Filters card,
 * then the table. New layout collapses the KPI surface into ContractsHero,
 * merges the scope toggle + filters + CTA into ContractsControlBar, and
 * keeps the three top-level tabs as the content switcher.
 *
 * SCOPE RULES (2026-07-28 fix — "a value computed from the wrong scope,
 * presented as the whole truth"):
 *
 *   - The hero's numbers describe the FACILITY SCOPE and come only from
 *     `useContractStats`. Nothing on it may be derived from the loaded
 *     rows: `activeCount`/`expiringSoon` used to be counted from the first
 *     page of `getContracts` (20 rows), so "45 Total / 20 Active" was
 *     structurally impossible to exceed and "expiring soon" moved with
 *     whatever had been edited recently.
 *   - Search is a SERVER filter (`filters.search`) so a contract past the
 *     loaded page is reachable by name — the old client-side pass could
 *     only ever match rows that had already been downloaded, while the
 *     empty state cheerfully offered "try adjusting your search".
 *   - The table still loads a bounded page (`LIST_PAGE_SIZE`); when the
 *     scope holds more, the truncation is stated under the table rather
 *     than implied.
 *   - CSV export walks the whole filtered set via `fetchContractsForExport`
 *     and says so when the hard row cap bites.
 */
interface ContractsListClientProps {
  facilityId: string
  userId?: string
}

const SCOPE_LABEL: Record<FacilityScope, string> = {
  this: "This facility",
  all: "All facilities",
  shared: "Shared with this facility",
}

/**
 * Rows fetched per list render. The server clamps `pageSize` at 100
 * (`contractFiltersSchema`), so this is the largest honest page; anything
 * beyond it is disclosed by the truncation note under the table.
 */
const LIST_PAGE_SIZE = 100

/** Debounce before a keystroke becomes a server query. */
const SEARCH_DEBOUNCE_MS = 250

export function ContractsListClient({
  facilityId,
  userId,
}: ContractsListClientProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [activeTab, setActiveTab] = useState("contracts")
  // `searchQuery` is what the input shows; `searchTerm` is what the SERVER
  // is filtering on (debounced). Two states rather than one because the
  // query key must not re-key on every keystroke.
  const [searchQuery, setSearchQuery] = useState("")
  const [searchTerm, setSearchTerm] = useState("")
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [statusFilter, setStatusFilter] = useState<ContractStatus | "all">(
    "all",
  )
  const [typeFilter, setTypeFilter] = useState<ContractType | "all">("all")
  const [facilityFilter, setFacilityFilter] = useState<string>("all")

  // Subsystem 9.2 — 3-way facility scope persisted in the URL (?scope=...).
  const scopeParam = searchParams.get("scope")
  const facilityScope: FacilityScope =
    scopeParam === "all" || scopeParam === "shared" ? scopeParam : "this"

  const setFacilityScope = useCallback(
    (next: FacilityScope) => {
      const params = new URLSearchParams(searchParams.toString())
      if (next === "this") params.delete("scope")
      else params.set("scope", next)
      const qs = params.toString()
      router.replace(qs ? `${pathname}?${qs}` : pathname)
    },
    [pathname, router, searchParams],
  )

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [contractToDelete, setContractToDelete] = useState<{
    id: string
    name: string
  } | null>(null)
  const [compareOpen, setCompareOpen] = useState(false)
  const [rowSelection, setRowSelection] = useState<Record<string, boolean>>({})
  const [isExporting, setIsExporting] = useState(false)

  // Push the search box at the server on a debounce (same shape as
  // components/shared/shells/command-search.tsx: the timer is armed from the
  // change handler, never from an effect mirroring state).
  const handleSearchQueryChange = useCallback((next: string) => {
    setSearchQuery(next)
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
    searchDebounceRef.current = setTimeout(() => {
      setSearchTerm(next.trim())
    }, SEARCH_DEBOUNCE_MS)
  }, [])

  const clearSearch = useCallback(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
    setSearchQuery("")
    setSearchTerm("")
  }, [])

  useEffect(() => {
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
    }
  }, [])

  // `rowSelection` (owned by the table + the Compare tab) is the single
  // source of truth for which contracts are selected to compare. Deriving
  // this with useMemo removes the old useState+effect mirror, which could
  // tear (the effect overwrote Compare-tab selections on the next
  // rowSelection change) and rendered one frame stale.
  const selectedForCompare = useMemo(
    () => Object.keys(rowSelection).filter((k) => rowSelection[k]),
    [rowSelection],
  )

  // Compare tab toggles the same `rowSelection` map, capped at 5 rows.
  const toggleCompareSelection = useCallback((id: string) => {
    setRowSelection((prev) => {
      if (prev[id]) {
        const next = { ...prev }
        delete next[id]
        return next
      }
      if (Object.values(prev).filter(Boolean).length >= 5) return prev
      return { ...prev, [id]: true }
    })
  }, [])

  // Everything the SERVER filters on. `search` belongs here — not in a
  // client-side pass over the loaded page — or contracts past the page
  // boundary are unfindable by name.
  const filters = useMemo(
    () => ({
      ...(statusFilter !== "all" && { status: statusFilter }),
      ...(typeFilter !== "all" && { type: typeFilter }),
      ...(searchTerm !== "" && { search: searchTerm }),
      facilityScope,
      pageSize: LIST_PAGE_SIZE,
    }),
    [statusFilter, typeFilter, searchTerm, facilityScope],
  )

  const { data, isLoading } = useContracts(facilityId, filters)
  const { data: stats, isLoading: isStatsLoading } = useContractStats(
    facilityId,
    facilityScope,
  )
  const deleteMutation = useDeleteContract()

  // B3 (2026-06-11): attention badge on the Pending Approval tab. Same query
  // key as PendingContractsTab, so TanStack Query serves both from one cache
  // entry — and the same canonical filter the tab uses for its "awaiting
  // review" rows, so the badge count cannot drift from what the tab shows.
  const { data: pendingSubmissions } = useFacilityPendingContracts(facilityId)
  const awaitingReviewCount = filterAwaitingReview(pendingSubmissions).length

  const allContracts = data?.contracts ?? []

  // Charles W1.X-D: `getContracts` populates canonical reducers directly.
  const compareContracts = useMemo<CompareContract[]>(
    () =>
      allContracts
        .filter((c) => selectedForCompare.includes(c.id))
        .map((c) => ({
          id: c.id,
          name: c.name,
          vendorName: c.vendor.name,
          contractType: c.contractType,
          status: c.status,
          effectiveDate: new Date(c.effectiveDate),
          expirationDate: new Date(c.expirationDate),
          totalValue: Number(c.totalValue),
          rebateEarned: Number(c.rebateEarned ?? 0),
          spend: Number(c.currentSpend ?? 0),
        })),
    [allContracts, selectedForCompare],
  )

  const columns = useMemo(
    () =>
      getContractColumns(
        {
          onView: (id) => router.push(`/dashboard/contracts/${id}`),
          onEdit: (id) => router.push(`/dashboard/contracts/${id}/edit`),
          onDelete: (contract) => {
            setContractToDelete({ id: contract.id, name: contract.name })
            setDeleteDialogOpen(true)
          },
        },
        { selectable: true },
      ),
    [router],
  )

  const facilityOptions = useMemo(() => {
    const map = new Map<string, string>()
    for (const c of allContracts) {
      if (c.facility?.id && c.facility?.name) {
        map.set(c.facility.id, c.facility.name)
      }
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }))
  }, [allContracts])

  // Search + status + type are applied by the server (see `filters`). The
  // facility dropdown stays a client-side narrowing of the loaded page.
  const contracts = useMemo(
    () =>
      facilityFilter === "all"
        ? allContracts
        : allContracts.filter((c) => c.facility?.id === facilityFilter),
    [allContracts, facilityFilter],
  )

  // Three different counts, three different scopes — never print two of
  // them side by side without saying which is which:
  //   matchingTotal — every row the SERVER matched for `filters`
  //   loadedCount   — the page the server actually sent back
  //   shownCount    — what the table renders (loaded page ∩ facility dropdown)
  const matchingTotal = data?.total ?? 0
  const loadedCount = allContracts.length
  const shownCount = contracts.length
  const isFacilityNarrowed = facilityFilter !== "all"
  const isTruncated = matchingTotal > loadedCount

  const isEmpty = !isLoading && shownCount === 0
  const hasAnyContracts = !isLoading && loadedCount > 0
  /** Filters other than the search box — they shrink what the search saw. */
  const hasNarrowingFilters =
    statusFilter !== "all" || typeFilter !== "all" || isFacilityNarrowed
  const hasActiveFilters =
    searchQuery.trim() !== "" || hasNarrowingFilters || facilityScope !== "this"

  const handleDeleteContract = async () => {
    if (contractToDelete) {
      await deleteMutation.mutateAsync(contractToDelete.id)
      setDeleteDialogOpen(false)
      setContractToDelete(null)
    }
  }

  // The export used to serialize `contracts` — the loaded page — under a
  // filename that claimed to be "contracts". It now pulls the whole
  // filtered set from the server, and when the hard row cap bites it says
  // so in both the toast and the filename.
  const handleDownloadCsv = useCallback(async () => {
    setIsExporting(true)
    try {
      const { rows: fetched, total, capped } = await fetchContractsForExport(
        facilityId,
        filters,
      )
      const narrowed = facilityFilter !== "all"
      const scoped = narrowed
        ? fetched.filter((c) => c.facility?.id === facilityFilter)
        : fetched
      const rows = scoped.map((c) => ({
        name: c.name,
        vendorName: c.vendor.name,
        contractType: c.contractType,
        status: c.status,
        effectiveDate: new Date(c.effectiveDate).toISOString().slice(0, 10),
        expirationDate: new Date(c.expirationDate).toISOString().slice(0, 10),
        totalValue: Number(c.totalValue),
        spend: Number(c.currentSpend ?? 0),
        rebateEarned: Number(c.rebateEarned ?? 0),
      }))
      // `rows.length` is post-narrowing, `total` is the server's count for
      // the filters IT saw, `fetched.length` is what came back before the
      // narrowing. The summary keeps each one attached to its own scope
      // instead of printing "12 of 143" as though they were comparable.
      const summary = summarizeContractsExport({
        exportedCount: rows.length,
        fetchedCount: fetched.length,
        total,
        capped,
        narrowed,
        stamp: new Date().toISOString().slice(0, 10),
      })

      if (rows.length === 0) {
        toast.info(summary.message)
        return
      }

      const csv = buildContractsCSV(rows)
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = summary.filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

      if (summary.tone === "warning") toast.warning(summary.message)
      else toast.success(summary.message)
    } catch (err) {
      console.error("[contracts-list] CSV export failed", err, { facilityId })
      toast.error("Couldn't build the contracts CSV. Please try again.")
    } finally {
      setIsExporting(false)
    }
  }, [facilityId, facilityFilter, filters])

  return (
    <div className="flex flex-col gap-6">
      <div className="space-y-1">
        <h1 className="text-3xl font-bold tracking-tight">Contracts</h1>
        <p className="text-muted-foreground">
          Manage, track, and compare vendor contracts
        </p>
      </div>

      {/* Every prop below comes from `stats` — one server-side scope, one
          round trip. Do not fall back to the loaded rows for any of them:
          a page-derived fallback is what made "45 Total / 20 Active"
          possible in the first place. */}
      <ContractsHero
        totalContracts={stats?.totalContracts ?? 0}
        activeCount={stats?.activeContracts ?? 0}
        totalValue={Number(stats?.totalValue ?? 0)}
        rebatesYTD={Number(stats?.totalRebates ?? 0)}
        expiringSoon={stats?.expiringSoon ?? 0}
        expiringSoonWindowDays={stats?.expiringSoonWindowDays}
        scopeLabel={SCOPE_LABEL[facilityScope]}
        isLoading={isStatsLoading || !stats}
      />

      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="space-y-4"
      >
        <TabsList>
          <TabsTrigger value="contracts" className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            All Contracts
          </TabsTrigger>
          <TabsTrigger value="pending" className="flex items-center gap-2">
            <Inbox className="h-4 w-4" />
            Pending Approval
            {awaitingReviewCount > 0 && (
              <Badge
                variant="secondary"
                className="bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100"
              >
                {awaitingReviewCount}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="compare" className="flex items-center gap-2">
            <ArrowLeftRight className="h-4 w-4" />
            Compare
          </TabsTrigger>
        </TabsList>

        <TabsContent value="contracts" className="space-y-4">
          <ContractsControlBar
            facilityScope={facilityScope}
            onFacilityScopeChange={setFacilityScope}
            searchQuery={searchQuery}
            onSearchQueryChange={handleSearchQueryChange}
            statusFilter={statusFilter}
            onStatusFilterChange={setStatusFilter}
            typeFilter={typeFilter}
            onTypeFilterChange={setTypeFilter}
            facilities={facilityOptions}
            facilityFilter={facilityFilter}
            onFacilityFilterChange={setFacilityFilter}
            onDownloadCsv={handleDownloadCsv}
            canDownload={matchingTotal > 0 && !isExporting}
          />

          {isLoading && !hasAnyContracts ? (
            <div className="space-y-3 rounded-lg border bg-card p-6 shadow-xs">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : isEmpty ? (
            <Card>
              <CardContent className="p-0">
                <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
                  <FileText className="h-8 w-8 text-muted-foreground/50" />
                  {hasActiveFilters ? (
                    <>
                      <p className="font-medium">
                        No contracts match your filters
                      </p>
                      {/* Search runs on the server across the whole scope, so
                          this really does mean "nothing matched" — not
                          "nothing matched on the page we happened to load". */}
                      <p className="text-sm text-muted-foreground">
                        {searchTerm !== "" ? (
                          hasNarrowingFilters ? (
                            // A status/type/facility filter is also on, so the
                            // search did NOT cover all `totalContracts` rows —
                            // don't claim a number the query never scanned.
                            <>
                              Nothing in{" "}
                              {SCOPE_LABEL[facilityScope].toLowerCase()} matched
                              &ldquo;{searchTerm}&rdquo; under the current
                              status, type, and facility filters. Try a
                              different term, or clear the other filters.
                            </>
                          ) : (
                            <>
                              Searched all {stats?.totalContracts ?? 0}{" "}
                              contracts in{" "}
                              {SCOPE_LABEL[facilityScope].toLowerCase()} for
                              &ldquo;{searchTerm}&rdquo; — nothing matched. Try
                              a different term or scope.
                            </>
                          )
                        ) : (
                          <>
                            Try adjusting your scope, status, or type filters.
                          </>
                        )}
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          clearSearch()
                          setStatusFilter("all")
                          setTypeFilter("all")
                          setFacilityFilter("all")
                          setFacilityScope("this")
                        }}
                      >
                        Clear all filters
                      </Button>
                    </>
                  ) : (
                    <>
                      <p className="font-medium">No contracts yet</p>
                      <p className="text-sm text-muted-foreground">
                        Create your first contract to start tracking rebates
                        and spend.
                      </p>
                      <Button asChild variant="outline" size="sm">
                        <Link href="/dashboard/contracts/new">
                          <Plus className="mr-2 h-4 w-4" />
                          Create your first contract
                        </Link>
                      </Button>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          ) : (
            <>
              {selectedForCompare.length >= 2 && (
                <div className="sticky top-0 z-10 flex items-center justify-between rounded-md border bg-card/95 px-4 py-2 backdrop-blur supports-[backdrop-filter]:bg-card/80">
                  <p className="text-sm">
                    {selectedForCompare.length} contracts selected
                  </p>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setRowSelection({})}
                    >
                      Clear
                    </Button>
                    <Button size="sm" onClick={() => setCompareOpen(true)}>
                      Compare ({selectedForCompare.length})
                    </Button>
                  </div>
                </div>
              )}
              <DataTable
                columns={columns}
                data={contracts}
                isLoading={isLoading}
                enableColumnFilters
                onRowClick={(row) =>
                  router.push(`/dashboard/contracts/${row.id}`)
                }
                rowSelection={rowSelection}
                onRowSelectionChange={setRowSelection}
                getRowId={(row) => row.id}
              />
              {/* A silent cap is the bug; a labelled one is a feature.
                  The facility dropdown narrows the LOADED PAGE only, so when
                  it is active the rendered row count and the loaded row count
                  are different numbers and the note has to name both. */}
              {isTruncated && (
                <p className="px-1 text-xs text-muted-foreground">
                  {isFacilityNarrowed ? (
                    <>
                      Showing {shownCount} of the {loadedCount} most recently
                      updated contracts loaded ({matchingTotal} match the
                      current filters). The facility dropdown filters this
                      loaded page only — search or filter to reach the rest.
                    </>
                  ) : (
                    <>
                      Showing the {loadedCount} most recently updated of{" "}
                      {matchingTotal} matching contracts. The facility dropdown
                      lists only the facilities on this page — search or filter
                      to reach the rest.
                    </>
                  )}{" "}
                  The portfolio totals above are computed over the whole scope,
                  and the CSV export covers every match, not just this page.
                </p>
              )}
            </>
          )}
        </TabsContent>

        <TabsContent value="pending" className="space-y-4">
          <PendingContractsTab facilityId={facilityId} userId={userId ?? ""} />
        </TabsContent>

        <TabsContent value="compare" className="space-y-4">
          <div className="flex justify-end">
            <Button
              size="sm"
              disabled={selectedForCompare.length < 2}
              onClick={() => setCompareOpen(true)}
            >
              Compare ({selectedForCompare.length})
            </Button>
          </div>
          <CompareTab
            contracts={contracts}
            selected={selectedForCompare}
            onToggle={toggleCompareSelection}
            onClear={() => setRowSelection({})}
          />
        </TabsContent>
      </Tabs>

      <CompareModal
        open={compareOpen}
        onOpenChange={setCompareOpen}
        contracts={compareContracts}
      />

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Contract</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this contract? This action cannot
              be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteContract}
              disabled={deleteMutation.isPending}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
