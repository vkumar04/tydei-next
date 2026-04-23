"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter, useSearchParams, usePathname } from "next/navigation"
import Link from "next/link"
import {
  ArrowLeftRight,
  FileText,
  Inbox,
  Plus,
} from "lucide-react"
import type { ContractStatus, ContractType } from "@prisma/client"
import {
  useContracts,
  useContractStats,
  useDeleteContract,
} from "@/hooks/use-contracts"
import { getContractColumns } from "@/components/contracts/contract-columns"
import { DataTable } from "@/components/shared/tables/data-table"
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

export function ContractsListClient({
  facilityId,
  userId,
}: ContractsListClientProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [activeTab, setActiveTab] = useState("contracts")
  const [searchQuery, setSearchQuery] = useState("")
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
  const [selectedForCompare, setSelectedForCompare] = useState<string[]>([])
  const [compareOpen, setCompareOpen] = useState(false)
  const [rowSelection, setRowSelection] = useState<Record<string, boolean>>({})

  useEffect(() => {
    setSelectedForCompare(
      Object.keys(rowSelection).filter((k) => rowSelection[k]),
    )
  }, [rowSelection])

  const filters = {
    ...(statusFilter !== "all" && { status: statusFilter }),
    ...(typeFilter !== "all" && { type: typeFilter }),
    facilityScope,
  }

  const { data, isLoading } = useContracts(facilityId, filters)
  const { data: stats } = useContractStats(facilityId, facilityScope)
  const deleteMutation = useDeleteContract()

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

  // Client-side search + facility filter.
  const contracts = useMemo(() => {
    return allContracts.filter((contract) => {
      const q = searchQuery.trim().toLowerCase()
      const matchesSearch =
        q === "" ||
        contract.name.toLowerCase().includes(q) ||
        contract.vendor.name.toLowerCase().includes(q) ||
        (contract.contractNumber ?? "").toLowerCase().includes(q)

      const matchesFacility =
        facilityFilter === "all" || contract.facility?.id === facilityFilter

      return matchesSearch && matchesFacility
    })
  }, [allContracts, searchQuery, facilityFilter])

  const isEmpty = !isLoading && contracts.length === 0
  const hasAnyContracts = !isLoading && allContracts.length > 0
  const hasActiveFilters =
    searchQuery.trim() !== "" ||
    statusFilter !== "all" ||
    typeFilter !== "all" ||
    facilityFilter !== "all" ||
    facilityScope !== "this"

  // Derived stats (spec §4.2).
  const derivedStats = useMemo(() => {
    const now = Date.now()
    const thirtyDays = 30 * 24 * 60 * 60 * 1000
    const rows = allContracts
    const active = rows.filter((c) => c.status === "active").length
    const expiringSoon = rows.filter((c) => {
      if (!c.expirationDate) return false
      const exp = new Date(c.expirationDate).getTime()
      return exp > now && exp - now <= thirtyDays && c.status !== "expired"
    }).length
    return { active, expiringSoon }
  }, [allContracts])

  const handleDeleteContract = async () => {
    if (contractToDelete) {
      await deleteMutation.mutateAsync(contractToDelete.id)
      setDeleteDialogOpen(false)
      setContractToDelete(null)
    }
  }

  const handleDownloadCsv = () => {
    const rows = contracts.map((c) => ({
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
    const csv = buildContractsCSV(rows)
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `contracts-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="space-y-1">
        <h1 className="text-3xl font-bold tracking-tight">Contracts</h1>
        <p className="text-muted-foreground">
          Manage, track, and compare vendor contracts
        </p>
      </div>

      <ContractsHero
        totalContracts={stats?.totalContracts ?? allContracts.length}
        activeCount={derivedStats.active}
        totalValue={Number(stats?.totalValue ?? 0)}
        rebatesYTD={Number(stats?.totalRebates ?? 0)}
        expiringSoon={derivedStats.expiringSoon}
        scopeLabel={SCOPE_LABEL[facilityScope]}
        isLoading={isLoading && !stats}
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
            onSearchQueryChange={setSearchQuery}
            statusFilter={statusFilter}
            onStatusFilterChange={setStatusFilter}
            typeFilter={typeFilter}
            onTypeFilterChange={setTypeFilter}
            facilities={facilityOptions}
            facilityFilter={facilityFilter}
            onFacilityFilterChange={setFacilityFilter}
            onDownloadCsv={handleDownloadCsv}
            canDownload={contracts.length > 0}
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
                      <p className="text-sm text-muted-foreground">
                        Try adjusting your search, scope, status, or type
                        filters.
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setSearchQuery("")
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
                onRowClick={(row) =>
                  router.push(`/dashboard/contracts/${row.id}`)
                }
                rowSelection={rowSelection}
                onRowSelectionChange={setRowSelection}
                getRowId={(row) => row.id}
              />
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
