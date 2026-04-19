"use client"

import { useState, useMemo } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import {
  Plus,
  FileText,
  DollarSign,
  TrendingUp,
  ArrowLeftRight,
  Check,
  Search,
  Download,
  Gauge,
  CalendarClock,
  CircleCheck,
  Inbox,
} from "lucide-react"
import type { ContractStatus, ContractType } from "@prisma/client"
import {
  useContracts,
  useContractStats,
  useDeleteContract,
  useContractMetricsBatch,
} from "@/hooks/use-contracts"
import { formatCurrency, formatDate } from "@/lib/formatting"
import { getContractColumns } from "@/components/contracts/contract-columns"
import { ContractFilters } from "@/components/contracts/contract-filters"
import { DataTable } from "@/components/shared/tables/data-table"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
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
import { ScoreBadge } from "@/components/shared/badges/score-badge"
import { CompareModal } from "./compare-modal"
import type { CompareContract } from "./compare-row-builder"
import { buildContractsCSV } from "./contract-export"

/** The 3-way facility scope filter per spec §4.3. */
type FacilityScope = "this" | "all" | "shared"

interface ContractsListClientProps {
  facilityId: string
  userId?: string
}

export function ContractsListClient({
  facilityId,
  userId,
}: ContractsListClientProps) {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState("contracts")
  const [searchQuery, setSearchQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState<ContractStatus | "all">(
    "all"
  )
  const [typeFilter, setTypeFilter] = useState<ContractType | "all">("all")
  const [facilityFilter, setFacilityFilter] = useState<string>("all")
  const [facilityScope, setFacilityScope] = useState<FacilityScope>("all")
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [contractToDelete, setContractToDelete] = useState<{
    id: string
    name: string
  } | null>(null)
  const [selectedForCompare, setSelectedForCompare] = useState<string[]>([])
  const [compareOpen, setCompareOpen] = useState(false)

  const filters = {
    ...(statusFilter !== "all" && { status: statusFilter }),
    ...(typeFilter !== "all" && { type: typeFilter }),
  }

  const { data, isLoading } = useContracts(facilityId, filters)
  const { data: stats } = useContractStats(facilityId)
  const deleteMutation = useDeleteContract()

  const allContracts = data?.contracts ?? []
  const contractIds = useMemo(() => allContracts.map((c) => c.id), [
    allContracts,
  ])

  // Subsystem 1 — live per-row metrics (spend / rebate / totalValue)
  const { data: metricsBatch } = useContractMetricsBatch(contractIds)

  // Merge live metrics onto each row so the columns render them.
  const contractsWithMetrics = useMemo(() => {
    if (!metricsBatch) return allContracts
    return allContracts.map((c) => {
      const m = metricsBatch[c.id]
      if (!m) return c
      return {
        ...c,
        metricsSpend: m.spend,
        metricsRebate: m.rebate,
      }
    })
  }, [allContracts, metricsBatch])

  // Build the serialized, flat shape the CompareModal expects. Uses the
  // live metrics batch so Spend/Rebate in the modal match what the list
  // columns are showing.
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
          rebateEarned: Number(metricsBatch?.[c.id]?.rebate ?? 0),
          spend: Number(metricsBatch?.[c.id]?.spend ?? 0),
          score: c.score,
          scoreBand: c.scoreBand,
        })),
    [allContracts, selectedForCompare, metricsBatch],
  )

  const columns = useMemo(
    () =>
      getContractColumns({
        onView: (id) => router.push(`/dashboard/contracts/${id}`),
        onEdit: (id) => router.push(`/dashboard/contracts/${id}/edit`),
        onDelete: (contract) => {
          setContractToDelete({ id: contract.id, name: contract.name })
          setDeleteDialogOpen(true)
        },
      }),
    [router]
  )

  // Facility options derived from the current result set so the filter matches
  // v0's "All Facilities" behavior.
  const facilityOptions = useMemo(() => {
    const map = new Map<string, string>()
    for (const c of contractsWithMetrics) {
      if (c.facility?.id && c.facility?.name) {
        map.set(c.facility.id, c.facility.name)
      }
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }))
  }, [contractsWithMetrics])

  // Client-side search + facility filter + 3-way scope (server already
  // applied status/type).
  const contracts = useMemo(() => {
    return contractsWithMetrics.filter((contract) => {
      const q = searchQuery.trim().toLowerCase()
      const matchesSearch =
        q === "" ||
        contract.name.toLowerCase().includes(q) ||
        contract.vendor.name.toLowerCase().includes(q) ||
        (contract.contractNumber ?? "").toLowerCase().includes(q)

      const matchesFacility =
        facilityFilter === "all" || contract.facility?.id === facilityFilter

      // 3-way facility scope:
      //  - this:   owned by the current facility AND not multi-facility
      //  - shared: multi-facility contracts (touches more than this facility)
      //  - all:    no scope narrowing (default)
      const isMulti = Boolean(contract.isMultiFacility)
      const ownedByThis = contract.facility?.id === facilityId
      const matchesScope =
        facilityScope === "all"
          ? true
          : facilityScope === "shared"
            ? isMulti
            : ownedByThis && !isMulti

      return matchesSearch && matchesFacility && matchesScope
    })
  }, [
    contractsWithMetrics,
    searchQuery,
    facilityFilter,
    facilityScope,
    facilityId,
  ])

  const isEmpty = !isLoading && contracts.length === 0
  const hasAnyContracts = !isLoading && allContracts.length > 0
  const hasActiveFilters =
    searchQuery.trim() !== "" ||
    statusFilter !== "all" ||
    typeFilter !== "all" ||
    facilityFilter !== "all" ||
    facilityScope !== "all"

  // Derived stats (spec §4.2). getContractStats gives totals; compute the
  // rest from the (already-loaded) contract list so we don't block cards
  // behind a second round-trip.
  const derivedStats = useMemo(() => {
    const now = Date.now()
    const thirtyDays = 30 * 24 * 60 * 60 * 1000
    const rows = allContracts
    const active = rows.filter((c) => c.status === "active").length
    const scored = rows.filter(
      (c): c is typeof c & { score: number } =>
        typeof c.score === "number" && c.score > 0
    )
    const avgScore =
      scored.length > 0
        ? Math.round(
            scored.reduce((sum, c) => sum + c.score, 0) / scored.length
          )
        : null
    const expiringSoon = rows.filter((c) => {
      if (!c.expirationDate) return false
      const exp = new Date(c.expirationDate).getTime()
      return exp > now && exp - now <= thirtyDays && c.status !== "expired"
    }).length
    return { active, avgScore, expiringSoon }
  }, [allContracts])

  const handleDeleteContract = async () => {
    if (contractToDelete) {
      await deleteMutation.mutateAsync(contractToDelete.id)
      setDeleteDialogOpen(false)
      setContractToDelete(null)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Contracts</h1>
          <p className="text-muted-foreground">
            Manage, track, and compare vendor contracts
          </p>
        </div>
        <Button asChild className="sm:self-start">
          <Link href="/dashboard/contracts/new">
            <Plus className="mr-2 h-4 w-4" />
            New Contract
          </Link>
        </Button>
      </div>

      {/* Summary Cards — Subsystem 2 */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <StatCard
          title="Total Contracts"
          value={stats?.totalContracts ?? allContracts.length}
          icon={FileText}
          isLoading={isLoading && !stats}
        />
        <StatCard
          title="Active"
          value={derivedStats.active}
          icon={CircleCheck}
          accent="green"
          isLoading={isLoading}
        />
        <StatCard
          title="Total Value"
          value={formatCurrency(stats?.totalValue ?? 0)}
          icon={DollarSign}
          isLoading={isLoading && !stats}
        />
        <StatCard
          title="Avg Score"
          value={derivedStats.avgScore ?? "—"}
          icon={Gauge}
          accent="blue"
          isLoading={isLoading}
        />
        <StatCard
          title="Expiring Soon"
          value={derivedStats.expiringSoon}
          description="Within 30 days"
          icon={CalendarClock}
          accent={derivedStats.expiringSoon > 0 ? "amber" : undefined}
          isLoading={isLoading}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-1">
        <StatCard
          title="Total Rebates Earned"
          value={formatCurrency(stats?.totalRebates ?? 0)}
          icon={TrendingUp}
          accent="green"
          isLoading={isLoading && !stats}
          wide
        />
      </div>

      {/* Tabs */}
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
          </TabsTrigger>
          <TabsTrigger value="compare" className="flex items-center gap-2">
            <ArrowLeftRight className="h-4 w-4" />
            Compare
          </TabsTrigger>
        </TabsList>

        <TabsContent value="contracts" className="space-y-4">
          {/* 3-way Facility Scope — Subsystem 3 */}
          <Tabs
            value={facilityScope}
            onValueChange={(v) => setFacilityScope(v as FacilityScope)}
          >
            <TabsList className="grid w-full grid-cols-3 sm:w-auto">
              <TabsTrigger value="this">This Facility</TabsTrigger>
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="shared">Shared</TabsTrigger>
            </TabsList>
          </Tabs>

          {/* Filters */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Search contracts, vendors, IDs..."
                    className="pl-9"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    id="contract-search"
                    aria-label="Search contracts"
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <ContractFilters
                    status={statusFilter}
                    onStatusChange={setStatusFilter}
                    type={typeFilter}
                    onTypeChange={setTypeFilter}
                    facilities={facilityOptions}
                    facilityFilter={facilityFilter}
                    onFacilityChange={setFacilityFilter}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const rows = contracts.map((c) => ({
                        name: c.name,
                        vendorName: c.vendor.name,
                        contractType: c.contractType,
                        status: c.status,
                        effectiveDate: new Date(c.effectiveDate)
                          .toISOString()
                          .slice(0, 10),
                        expirationDate: new Date(c.expirationDate)
                          .toISOString()
                          .slice(0, 10),
                        totalValue: Number(c.totalValue),
                        spend: Number(metricsBatch?.[c.id]?.spend ?? 0),
                        rebateEarned: Number(
                          metricsBatch?.[c.id]?.rebate ?? 0
                        ),
                      }))
                      const csv = buildContractsCSV(rows)
                      const blob = new Blob([csv], {
                        type: "text/csv;charset=utf-8",
                      })
                      const url = URL.createObjectURL(blob)
                      const a = document.createElement("a")
                      a.href = url
                      a.download = `contracts-${new Date()
                        .toISOString()
                        .slice(0, 10)}.csv`
                      document.body.appendChild(a)
                      a.click()
                      document.body.removeChild(a)
                      URL.revokeObjectURL(url)
                    }}
                  >
                    <Download className="mr-2 h-4 w-4" /> Download CSV
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Contracts Table */}
          {isLoading && !hasAnyContracts ? (
            <Card>
              <CardContent className="p-6">
                <div className="space-y-3">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : isEmpty ? (
            <Card>
              <CardContent className="p-0">
                <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
                  <FileText className="h-8 w-8 text-muted-foreground/50" />
                  {hasActiveFilters ? (
                    <>
                      <p className="font-medium">No contracts match your filters</p>
                      <p className="text-sm text-muted-foreground">
                        Try adjusting your search, scope, status, or type filters.
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setSearchQuery("")
                          setStatusFilter("all")
                          setTypeFilter("all")
                          setFacilityFilter("all")
                          setFacilityScope("all")
                        }}
                      >
                        Clear all filters
                      </Button>
                    </>
                  ) : (
                    <>
                      <p className="font-medium">No contracts yet</p>
                      <p className="text-sm text-muted-foreground">
                        Create your first contract to start tracking rebates and
                        spend.
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
            <DataTable
              columns={columns}
              data={contracts}
              isLoading={isLoading}
              onRowClick={(row) =>
                router.push(`/dashboard/contracts/${row.id}`)
              }
            />
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
            onToggle={(id) =>
              setSelectedForCompare((prev) => {
                if (prev.includes(id)) return prev.filter((x) => x !== id)
                if (prev.length >= 5) return prev
                return [...prev, id]
              })
            }
            onClear={() => setSelectedForCompare([])}
          />
        </TabsContent>
      </Tabs>

      <CompareModal
        open={compareOpen}
        onOpenChange={setCompareOpen}
        contracts={compareContracts}
      />

      {/* Delete Confirmation Dialog */}
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

// ─── StatCard ───────────────────────────────────────────────────────
// Lightweight uniform-height summary card used across Subsystem 2.
// Matches the shared MetricCard slot structure so the dashboard-rewrite
// spec's work later drops in cleanly.

type StatAccent = "green" | "blue" | "amber"

interface StatCardProps {
  title: string
  value: string | number
  description?: string
  icon: React.ComponentType<{ className?: string }>
  accent?: StatAccent
  isLoading?: boolean
  wide?: boolean
}

function StatCard({
  title,
  value,
  description,
  icon: Icon,
  accent,
  isLoading,
  wide,
}: StatCardProps) {
  const accentClass =
    accent === "green"
      ? "text-green-600 dark:text-green-400"
      : accent === "amber"
        ? "text-amber-600 dark:text-amber-400"
        : accent === "blue"
          ? "text-blue-600 dark:text-blue-400"
          : "text-muted-foreground"
  return (
    <Card className="h-full">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className={`h-4 w-4 ${accentClass}`} />
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-8 w-24" />
        ) : (
          <div
            className={`font-bold ${wide ? "text-3xl" : "text-2xl"} ${
              accent ? accentClass : ""
            }`}
          >
            {value}
          </div>
        )}
        {description && (
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        )}
      </CardContent>
    </Card>
  )
}

// ─── Compare Tab — Subsystem 4 ─────────────────────────────────────
// Supports up to 5 contracts side-by-side. Five cards per spec §4.4:
//   1. Contract Overview
//   2. Rebate Terms
//   3. Financial Performance
//   4. Pricing Items
//   5. Contract Terms
// Each card renders a responsive grid keyed off selected count.

type ContractRow = ReturnType<
  typeof useContracts
>["data"] extends { contracts: infer R } | undefined
  ? R extends readonly (infer One)[]
    ? One
    : never
  : never

interface CompareTabProps {
  contracts: ContractRow[]
  selected: string[]
  onToggle: (id: string) => void
  onClear: () => void
}

function CompareTab({
  contracts,
  selected,
  onToggle,
  onClear,
}: CompareTabProps) {
  const selectedContracts = useMemo(
    () =>
      selected
        .map((id) => contracts.find((c) => c.id === id))
        .filter((c): c is ContractRow => Boolean(c)),
    [selected, contracts]
  )

  return (
    <div className="space-y-6">
      {/* Contract Selection */}
      <Card>
        <CardHeader>
          <CardTitle>Select Contracts to Compare</CardTitle>
          <CardDescription>
            Choose 2-5 contracts to compare side by side
          </CardDescription>
        </CardHeader>
        <CardContent>
          {contracts.length === 0 ? (
            <div className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">
              No contracts match the current filters.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {contracts.map((contract) => {
                const isSelected = selected.includes(contract.id)
                const disabled = selected.length >= 5 && !isSelected
                return (
                  <button
                    type="button"
                    key={contract.id}
                    onClick={() => onToggle(contract.id)}
                    disabled={disabled}
                    className={`rounded-lg border-2 p-4 text-left transition-all ${
                      isSelected
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/50"
                    } ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
                    aria-pressed={isSelected}
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-semibold">{contract.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {contract.vendor.name}
                        </p>
                      </div>
                      <div
                        className={`flex h-5 w-5 items-center justify-center rounded-full border-2 ${
                          isSelected
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-muted-foreground"
                        }`}
                      >
                        {isSelected && <Check className="h-3 w-3" />}
                      </div>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <p className="text-muted-foreground">Value</p>
                        <p className="font-medium">
                          {formatCurrency(Number(contract.totalValue))}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Type</p>
                        <p className="font-medium capitalize">
                          {contract.contractType.replace("_", " ")}
                        </p>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
          {selected.length > 0 && (
            <div className="mt-4 flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {selected.length} contract{selected.length === 1 ? "" : "s"} selected
              </p>
              <Button variant="outline" size="sm" onClick={onClear}>
                Clear Selection
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Comparison Cards */}
      {selectedContracts.length >= 2 ? (
        <div className="space-y-4">
          <CompareOverviewCard contracts={selectedContracts} />
          <CompareRebateTermsCard contracts={selectedContracts} />
          <CompareFinancialCard contracts={selectedContracts} />
          <ComparePricingItemsCard contracts={selectedContracts} />
          <CompareContractTermsCard contracts={selectedContracts} />
        </div>
      ) : (
        <Card>
          <CardContent className="py-12 text-center">
            <ArrowLeftRight className="mx-auto mb-4 h-12 w-12 text-muted-foreground/50" />
            <p className="text-muted-foreground">
              Select at least 2 contracts above to see the comparison
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

// ─── Compare cards ─────────────────────────────────────────────────

function useCompareGridStyle(count: number) {
  return useMemo<React.CSSProperties>(
    () => ({
      display: "grid",
      gridTemplateColumns: `150px repeat(${count}, minmax(180px, 1fr))`,
      gap: "0",
    }),
    [count]
  )
}

function CompareSection({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">{children}</div>
      </CardContent>
    </Card>
  )
}

function CompareRow({
  label,
  children,
  style,
}: {
  label: string
  children: React.ReactNode[]
  style: React.CSSProperties
}) {
  return (
    <div
      className="border-b py-3 text-sm last:border-b-0"
      style={style}
    >
      <div className="font-medium text-muted-foreground">{label}</div>
      {children.map((cell, i) => (
        <div key={i} className="pr-4">
          {cell}
        </div>
      ))}
    </div>
  )
}

function statusBadge(status: string | null | undefined) {
  const s = status ?? "draft"
  const cls =
    s === "active"
      ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300"
      : s === "expired"
        ? "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300"
        : s === "pending"
          ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300"
          : "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300"
  return (
    <Badge variant="secondary" className={cls}>
      {s.charAt(0).toUpperCase() + s.slice(1)}
    </Badge>
  )
}

function CompareOverviewCard({ contracts }: { contracts: ContractRow[] }) {
  const style = useCompareGridStyle(contracts.length)
  return (
    <CompareSection
      title="Contract Overview"
      description="Side-by-side comparison of key attributes"
    >
      <div
        className="grid border-b pb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
        style={style}
      >
        <div>Attribute</div>
        {contracts.map((c) => (
          <div key={c.id} className="truncate pr-4 text-foreground">
            {c.name}
          </div>
        ))}
      </div>
      <CompareRow
        label="Vendor"
        style={style}
        children={contracts.map((c) => (
          <span key={c.id}>{c.vendor.name}</span>
        ))}
      />
      <CompareRow
        label="Type"
        style={style}
        children={contracts.map((c) => (
          <span key={c.id} className="capitalize">
            {c.contractType.replace("_", " ")}
          </span>
        ))}
      />
      <CompareRow
        label="Status"
        style={style}
        children={contracts.map((c) => (
          <span key={c.id}>{statusBadge(c.status)}</span>
        ))}
      />
      <CompareRow
        label="Effective"
        style={style}
        children={contracts.map((c) => (
          <span key={c.id}>
            {c.effectiveDate ? formatDate(c.effectiveDate) : "—"}
          </span>
        ))}
      />
      <CompareRow
        label="Expiration"
        style={style}
        children={contracts.map((c) => (
          <span key={c.id}>
            {c.expirationDate ? formatDate(c.expirationDate) : "—"}
          </span>
        ))}
      />
      <CompareRow
        label="Total Value"
        style={style}
        children={contracts.map((c) => (
          <span key={c.id} className="font-medium">
            {formatCurrency(Number(c.totalValue))}
          </span>
        ))}
      />
      <CompareRow
        label="Rebates Earned"
        style={style}
        children={contracts.map((c) => {
          const v = getMetricsRebate(c) ?? Number(c.rebateEarned ?? 0)
          return (
            <span
              key={c.id}
              className="font-medium text-green-600 dark:text-green-400"
            >
              {formatCurrency(v)}
            </span>
          )
        })}
      />
      <CompareRow
        label="Score"
        style={style}
        children={contracts.map((c) => (
          <span key={c.id}>
            <ScoreBadge score={c.score ?? null} size="sm" />
          </span>
        ))}
      />
      <CompareRow
        label="Facility"
        style={style}
        children={contracts.map((c) => (
          <span key={c.id}>{c.facility?.name ?? "All Facilities"}</span>
        ))}
      />
    </CompareSection>
  )
}

function CompareRebateTermsCard({ contracts }: { contracts: ContractRow[] }) {
  return (
    <CompareSection
      title="Rebate Terms"
      description="Tiered structures per contract (best effort from summary data)"
    >
      <div
        className="grid gap-4"
        style={{ gridTemplateColumns: `repeat(${contracts.length}, minmax(180px, 1fr))` }}
      >
        {contracts.map((c) => (
          <div key={c.id} className="rounded-md border p-3">
            <p className="mb-2 font-semibold">{c.name}</p>
            <div className="space-y-1 text-sm text-muted-foreground">
              <div className="flex items-center justify-between">
                <span>Performance</span>
                <span className="capitalize text-foreground">
                  {c.performancePeriod ?? "monthly"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>Rebate Pay</span>
                <span className="capitalize text-foreground">
                  {c.rebatePayPeriod ?? "quarterly"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>Current Spend</span>
                <span className="text-foreground">
                  {formatCurrency(getMetricsSpend(c) ?? 0)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>Earned</span>
                <span className="font-medium text-green-600 dark:text-green-400">
                  {formatCurrency(
                    getMetricsRebate(c) ?? Number(c.rebateEarned ?? 0)
                  )}
                </span>
              </div>
              {c.gpoAffiliation && (
                <div className="flex items-center justify-between">
                  <span>GPO</span>
                  <span className="text-foreground">{c.gpoAffiliation}</span>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </CompareSection>
  )
}

function CompareFinancialCard({ contracts }: { contracts: ContractRow[] }) {
  const style = useCompareGridStyle(contracts.length)
  return (
    <CompareSection
      title="Financial Performance"
      description="Spend, rebates, and effective rates"
    >
      <div
        className="grid border-b pb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
        style={style}
      >
        <div>Metric</div>
        {contracts.map((c) => (
          <div key={c.id} className="truncate pr-4 text-foreground">
            {c.name}
          </div>
        ))}
      </div>
      <CompareRow
        label="Total Spend"
        style={style}
        children={contracts.map((c) => (
          <span key={c.id} className="font-medium">
            {formatCurrency(getMetricsSpend(c) ?? 0)}
          </span>
        ))}
      />
      <CompareRow
        label="Rebates Earned"
        style={style}
        children={contracts.map((c) => (
          <span
            key={c.id}
            className="font-medium text-green-600 dark:text-green-400"
          >
            {formatCurrency(
              getMetricsRebate(c) ?? Number(c.rebateEarned ?? 0)
            )}
          </span>
        ))}
      />
      <CompareRow
        label="Rebates Collected"
        style={style}
        children={contracts.map((c) => (
          <span key={c.id}>{formatCurrency(Number(c.rebateCollected ?? 0))}</span>
        ))}
      />
      <CompareRow
        label="Outstanding"
        style={style}
        children={contracts.map((c) => {
          const earned = getMetricsRebate(c) ?? Number(c.rebateEarned ?? 0)
          const collected = Number(c.rebateCollected ?? 0)
          const outstanding = Math.max(earned - collected, 0)
          return (
            <span
              key={c.id}
              className={
                outstanding > 0
                  ? "font-medium text-amber-600 dark:text-amber-400"
                  : "text-muted-foreground"
              }
            >
              {formatCurrency(outstanding)}
            </span>
          )
        })}
      />
      <CompareRow
        label="Effective Rate"
        style={style}
        children={contracts.map((c) => {
          const spend = getMetricsSpend(c) ?? 0
          const earned = getMetricsRebate(c) ?? Number(c.rebateEarned ?? 0)
          const rate = spend > 0 ? (earned / spend) * 100 : 0
          const cls =
            rate >= 5
              ? "text-green-600 dark:text-green-400"
              : rate >= 2
                ? "text-blue-600 dark:text-blue-400"
                : "text-muted-foreground"
          return (
            <span key={c.id} className={`font-medium ${cls}`}>
              {spend > 0 ? `${rate.toFixed(2)}%` : "—"}
            </span>
          )
        })}
      />
    </CompareSection>
  )
}

function ComparePricingItemsCard({ contracts }: { contracts: ContractRow[] }) {
  const style = useCompareGridStyle(contracts.length)
  return (
    <CompareSection
      title="Pricing Items"
      description="Category coverage and pricing footprint"
    >
      <div
        className="grid border-b pb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
        style={style}
      >
        <div>Metric</div>
        {contracts.map((c) => (
          <div key={c.id} className="truncate pr-4 text-foreground">
            {c.name}
          </div>
        ))}
      </div>
      <CompareRow
        label="Primary Category"
        style={style}
        children={contracts.map((c) => (
          <span key={c.id}>{c.productCategory?.name ?? "—"}</span>
        ))}
      />
      <CompareRow
        label="Annual Value"
        style={style}
        children={contracts.map((c) => (
          <span key={c.id}>{formatCurrency(Number(c.annualValue ?? 0))}</span>
        ))}
      />
      <CompareRow
        label="Total Value"
        style={style}
        children={contracts.map((c) => (
          <span key={c.id} className="font-medium">
            {formatCurrency(Number(c.totalValue))}
          </span>
        ))}
      />
      <CompareRow
        label="Avg Monthly Value"
        style={style}
        children={contracts.map((c) => {
          const months = monthsBetween(c.effectiveDate, c.expirationDate)
          const avg =
            months > 0 ? Number(c.totalValue) / months : Number(c.totalValue)
          return <span key={c.id}>{formatCurrency(avg)}</span>
        })}
      />
    </CompareSection>
  )
}

function CompareContractTermsCard({ contracts }: { contracts: ContractRow[] }) {
  const style = useCompareGridStyle(contracts.length)
  return (
    <CompareSection
      title="Contract Terms"
      description="Duration, commitments, and scope"
    >
      <div
        className="grid border-b pb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
        style={style}
      >
        <div>Metric</div>
        {contracts.map((c) => (
          <div key={c.id} className="truncate pr-4 text-foreground">
            {c.name}
          </div>
        ))}
      </div>
      <CompareRow
        label="Duration"
        style={style}
        children={contracts.map((c) => {
          const months = monthsBetween(c.effectiveDate, c.expirationDate)
          return <span key={c.id}>{months > 0 ? `${months} months` : "—"}</span>
        })}
      />
      <CompareRow
        label="Days Remaining"
        style={style}
        children={contracts.map((c) => {
          const days = daysUntil(c.expirationDate)
          const cls =
            days < 0
              ? "text-red-600 dark:text-red-400"
              : days < 30
                ? "text-amber-600 dark:text-amber-400"
                : days < 180
                  ? "text-yellow-600 dark:text-yellow-400"
                  : "text-foreground"
          return (
            <span key={c.id} className={`font-medium ${cls}`}>
              {Number.isFinite(days) ? `${days} days` : "—"}
            </span>
          )
        })}
      />
      <CompareRow
        label="Expiring Soon"
        style={style}
        children={contracts.map((c) => {
          const days = daysUntil(c.expirationDate)
          if (days > 0 && days < 180) {
            return (
              <Badge
                key={c.id}
                variant="secondary"
                className="bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-300"
              >
                Expiring Soon
              </Badge>
            )
          }
          return <span key={c.id}>—</span>
        })}
      />
      <CompareRow
        label="Auto Renewal"
        style={style}
        children={contracts.map((c) => (
          <span key={c.id}>{c.autoRenewal ? "Yes" : "No"}</span>
        ))}
      />
      <CompareRow
        label="Scope"
        style={style}
        children={contracts.map((c) => (
          <span key={c.id} className="capitalize">
            {c.isMultiFacility ? "Multi-facility" : "Single facility"}
          </span>
        ))}
      />
      <CompareRow
        label="Termination Notice"
        style={style}
        children={contracts.map((c) => (
          <span key={c.id}>
            {c.terminationNoticeDays
              ? `${c.terminationNoticeDays} days`
              : "—"}
          </span>
        ))}
      />
      <CompareRow
        label="Market Share Commit"
        style={style}
        children={contracts.map((c) => (
          <span key={c.id}>
            {c.marketShareCommitment !== null &&
            c.marketShareCommitment !== undefined
              ? `${Number(c.marketShareCommitment).toFixed(1)}%`
              : "—"}
          </span>
        ))}
      />
      <CompareRow
        label="Compliance Rate"
        style={style}
        children={contracts.map((c) => (
          <span key={c.id}>
            {c.complianceRate !== null && c.complianceRate !== undefined
              ? `${Number(c.complianceRate).toFixed(1)}%`
              : "—"}
          </span>
        ))}
      />
    </CompareSection>
  )
}

// ─── helpers ───────────────────────────────────────────────────────

function getMetricsSpend(c: ContractRow): number | undefined {
  return (c as ContractRow & { metricsSpend?: number }).metricsSpend
}
function getMetricsRebate(c: ContractRow): number | undefined {
  return (c as ContractRow & { metricsRebate?: number }).metricsRebate
}

function monthsBetween(
  start: Date | string | null | undefined,
  end: Date | string | null | undefined
): number {
  if (!start || !end) return 0
  const s = new Date(start)
  const e = new Date(end)
  const ms = e.getTime() - s.getTime()
  if (!Number.isFinite(ms) || ms <= 0) return 0
  return Math.round(ms / (1000 * 60 * 60 * 24 * 30.44))
}

function daysUntil(end: Date | string | null | undefined): number {
  if (!end) return Number.NaN
  const ms = new Date(end).getTime() - Date.now()
  return Math.round(ms / (1000 * 60 * 60 * 24))
}
