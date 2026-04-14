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
} from "lucide-react"
import type { ContractStatus, ContractType } from "@prisma/client"
import {
  useContracts,
  useContractStats,
  useDeleteContract,
} from "@/hooks/use-contracts"
import { formatCurrency } from "@/lib/formatting"
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
import { Inbox } from "lucide-react"

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
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [contractToDelete, setContractToDelete] = useState<{
    id: string
    name: string
  } | null>(null)
  const [selectedForCompare, setSelectedForCompare] = useState<string[]>([])

  const filters = {
    ...(statusFilter !== "all" && { status: statusFilter }),
    ...(typeFilter !== "all" && { type: typeFilter }),
  }

  const { data, isLoading } = useContracts(facilityId, filters)
  const { data: stats } = useContractStats(facilityId)
  const deleteMutation = useDeleteContract()

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

  const allContracts = data?.contracts ?? []

  // Facility options derived from the current result set so the filter matches
  // v0's "All Facilities" behavior.
  const facilityOptions = useMemo(() => {
    const map = new Map<string, string>()
    for (const c of allContracts) {
      if (c.facility?.id && c.facility?.name) {
        map.set(c.facility.id, c.facility.name)
      }
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }))
  }, [allContracts])

  // Client-side search + facility filter (server already applied status/type)
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Contracts</h1>
          <p className="text-muted-foreground">
            Manage, track, and compare vendor contracts
          </p>
        </div>
        <Button asChild>
          <Link href="/dashboard/contracts/new">
            <Plus className="mr-2 h-4 w-4" />
            New Contract
          </Link>
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Total Contracts
            </CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {stats?.totalContracts ?? 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Total Contract Value
            </CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatCurrency(stats?.totalValue ?? 0)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Total Rebates Earned
            </CardTitle>
            <TrendingUp className="h-4 w-4 text-green-600 dark:text-green-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600 dark:text-green-400">
              {formatCurrency(stats?.totalRebates ?? 0)}
            </div>
          </CardContent>
        </Card>
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
            Pending
          </TabsTrigger>
          <TabsTrigger value="compare" className="flex items-center gap-2">
            <ArrowLeftRight className="h-4 w-4" />
            Compare
          </TabsTrigger>
        </TabsList>

        <TabsContent value="contracts" className="space-y-4">
          {/* Filters */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Search contracts, vendors, IDs..."
                    className="pl-9"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    id="contract-search"
                  />
                </div>
                <ContractFilters
                  status={statusFilter}
                  onStatusChange={setStatusFilter}
                  type={typeFilter}
                  onTypeChange={setTypeFilter}
                  facilities={facilityOptions}
                  facilityFilter={facilityFilter}
                  onFacilityChange={setFacilityFilter}
                />
                <Button variant="outline" size="icon">
                  <Download className="h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Contracts Table */}
          {isEmpty ? (
            <Card>
              <CardContent className="p-0">
                <div className="flex flex-col items-center justify-center gap-2 py-16">
                  <FileText className="h-8 w-8 text-muted-foreground/50" />
                  <p className="text-muted-foreground">No contracts found</p>
                  <Button asChild variant="outline" size="sm">
                    <Link href="/dashboard/contracts/new">
                      <Plus className="mr-2 h-4 w-4" />
                      Create your first contract
                    </Link>
                  </Button>
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

        <TabsContent value="pending">
          <PendingContractsTab facilityId={facilityId} userId={userId ?? ""} />
        </TabsContent>

        <TabsContent value="compare">
          <div className="space-y-6">
            {/* Contract Selection */}
            <Card>
              <CardHeader>
                <CardTitle>Select Contracts to Compare</CardTitle>
                <CardDescription>
                  Choose 2-4 contracts to compare side by side
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {contracts.map((contract) => {
                    const isSelected = selectedForCompare.includes(contract.id)
                    return (
                      <div
                        key={contract.id}
                        onClick={() => {
                          if (isSelected) {
                            setSelectedForCompare((prev) =>
                              prev.filter((id) => id !== contract.id)
                            )
                          } else if (selectedForCompare.length < 4) {
                            setSelectedForCompare((prev) => [
                              ...prev,
                              contract.id,
                            ])
                          }
                        }}
                        className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${
                          isSelected
                            ? "border-primary bg-primary/5"
                            : "border-border hover:border-primary/50"
                        } ${
                          selectedForCompare.length >= 4 && !isSelected
                            ? "opacity-50 cursor-not-allowed"
                            : ""
                        }`}
                      >
                        <div className="flex items-start justify-between">
                          <div>
                            <p className="font-semibold">{contract.name}</p>
                            <p className="text-sm text-muted-foreground">
                              {contract.vendor.name}
                            </p>
                          </div>
                          <div
                            className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
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
                      </div>
                    )
                  })}
                </div>
                {selectedForCompare.length > 0 && (
                  <div className="mt-4 flex items-center justify-between">
                    <p className="text-sm text-muted-foreground">
                      {selectedForCompare.length} contract(s) selected
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setSelectedForCompare([])}
                    >
                      Clear Selection
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Comparison Table */}
            {selectedForCompare.length >= 2 && (
              <Card>
                <CardHeader>
                  <CardTitle>Contract Overview</CardTitle>
                  <CardDescription>
                    Side-by-side comparison of selected contracts
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b">
                          <th className="w-[150px] py-3 text-left font-medium">
                            Attribute
                          </th>
                          {selectedForCompare.map((id) => {
                            const contract = contracts.find((c) => c.id === id)
                            return (
                              <th
                                key={id}
                                className="min-w-[180px] py-3 text-left font-medium"
                              >
                                {contract?.name}
                              </th>
                            )
                          })}
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="border-b">
                          <td className="py-3 font-medium">Vendor</td>
                          {selectedForCompare.map((id) => {
                            const contract = contracts.find((c) => c.id === id)
                            return (
                              <td key={id} className="py-3">
                                {contract?.vendor.name ?? "N/A"}
                              </td>
                            )
                          })}
                        </tr>
                        <tr className="border-b">
                          <td className="py-3 font-medium">Type</td>
                          {selectedForCompare.map((id) => {
                            const contract = contracts.find((c) => c.id === id)
                            return (
                              <td key={id} className="py-3 capitalize">
                                {contract?.contractType.replace("_", " ") ??
                                  "Usage"}
                              </td>
                            )
                          })}
                        </tr>
                        <tr className="border-b">
                          <td className="py-3 font-medium">Status</td>
                          {selectedForCompare.map((id) => {
                            const contract = contracts.find((c) => c.id === id)
                            return (
                              <td key={id} className="py-3">
                                <Badge
                                  variant="secondary"
                                  className={
                                    contract?.status === "active"
                                      ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300"
                                      : contract?.status === "expired"
                                        ? "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300"
                                        : contract?.status === "pending"
                                          ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300"
                                          : "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300"
                                  }
                                >
                                  {contract?.status
                                    ? contract.status.charAt(0).toUpperCase() +
                                      contract.status.slice(1)
                                    : "Draft"}
                                </Badge>
                              </td>
                            )
                          })}
                        </tr>
                        <tr className="border-b">
                          <td className="py-3 font-medium">Total Value</td>
                          {selectedForCompare.map((id) => {
                            const contract = contracts.find((c) => c.id === id)
                            return (
                              <td key={id} className="py-3 font-medium">
                                {formatCurrency(
                                  Number(contract?.totalValue ?? 0)
                                )}
                              </td>
                            )
                          })}
                        </tr>
                        <tr className="border-b">
                          <td className="py-3 font-medium">Facility</td>
                          {selectedForCompare.map((id) => {
                            const contract = contracts.find((c) => c.id === id)
                            return (
                              <td key={id} className="py-3">
                                {contract?.facility?.name ?? "All Facilities"}
                              </td>
                            )
                          })}
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}

            {selectedForCompare.length < 2 && (
              <Card>
                <CardContent className="py-12 text-center">
                  <ArrowLeftRight className="mx-auto h-12 w-12 text-muted-foreground/50 mb-4" />
                  <p className="text-muted-foreground">
                    Select at least 2 contracts above to see the comparison
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>
      </Tabs>

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
