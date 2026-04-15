"use client"

import { useState, useMemo } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { DataTable } from "@/components/shared/tables/data-table"
import { getVendorContractColumns } from "./vendor-contract-columns"
import { useVendorContracts } from "@/hooks/use-vendor-contracts"
import { useVendorPendingContracts } from "@/hooks/use-pending-contracts"
import { formatCurrency } from "@/lib/formatting"
import { FileStack, CheckCircle2, Clock, DollarSign } from "lucide-react"
import type { ContractStatus } from "@prisma/client"

interface VendorContractListProps {
  vendorId: string
}

type TabValue = ContractStatus | "all" | "submitted" | "rejected"

const STATUS_OPTIONS: { label: string; value: TabValue }[] = [
  { label: "All", value: "all" },
  { label: "Draft", value: "draft" },
  { label: "Submitted", value: "submitted" },
  { label: "Pending", value: "pending" },
  { label: "Active", value: "active" },
  { label: "Rejected", value: "rejected" },
]

export function VendorContractList({ vendorId }: VendorContractListProps) {
  const router = useRouter()
  const [tab, setTab] = useState<TabValue>("all")

  // Always fetch the full set for stats
  const { data: allData } = useVendorContracts(vendorId, { status: undefined })
  const allContracts = allData?.contracts ?? []

  // Fetch pending contracts from the PendingContract table
  const { data: pendingData, isLoading: pendingLoading } = useVendorPendingContracts(vendorId)
  const pendingContracts = pendingData ?? []

  // Map pending contracts to match the Contract table row shape
  const mappedPending = useMemo(
    () =>
      pendingContracts
        .filter((pc) => pc.status === "submitted")
        .map((pc) => ({
          id: pc.id,
          name: pc.contractName,
          contractNumber: null,
          vendorId: pc.vendorId,
          facilityId: pc.facilityId ?? null,
          contractType: pc.contractType,
          status: "pending" as ContractStatus,
          effectiveDate: pc.effectiveDate ? new Date(pc.effectiveDate) : new Date(),
          expirationDate: pc.expirationDate ? new Date(pc.expirationDate) : new Date(),
          totalValue: pc.totalValue ?? 0,
          annualValue: null,
          description: null,
          createdAt: new Date(pc.submittedAt),
          updatedAt: new Date(pc.submittedAt),
          productCategoryId: null,
          facility: pc.facility
            ? { id: pc.facility.id, name: pc.facility.name }
            : null,
          productCategory: null,
        })),
    [pendingContracts],
  )

  const { data, isLoading: contractsLoading } = useVendorContracts(vendorId, {
    status:
      tab === "all" || tab === "submitted" || tab === "rejected"
        ? undefined
        : (tab as ContractStatus),
  })

  const rawContracts = data?.contracts ?? []

  // Merge contracts with pending depending on the active filter
  const contracts = useMemo(() => {
    if (tab === "submitted") return mappedPending
    if (tab === "rejected") return []
    if (tab === "all") return [...rawContracts, ...mappedPending]
    return rawContracts
  }, [tab, rawContracts, mappedPending])

  const isLoading = contractsLoading || pendingLoading

  const columns = getVendorContractColumns((id) => {
    // Check if this is a pending contract
    const isPending = mappedPending.some((pc) => pc.id === id)
    if (isPending) {
      router.push(`/vendor/contracts/pending/${id}`)
    } else {
      router.push(`/vendor/contracts/${id}`)
    }
  })

  // Compute stats from the full (unfiltered) data set + pending
  const activeCount = allContracts.filter((c) => c.status === "active").length
  const pendingCount = mappedPending.length
  const totalValue = allContracts.reduce(
    (sum, c) => sum + Number(c.totalValue ?? 0),
    0
  )

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Total Contracts</CardTitle>
            <FileStack className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{allContracts.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Active</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600 dark:text-green-400">{activeCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Pending Review</CardTitle>
            <Clock className="h-4 w-4 text-yellow-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-600">{pendingCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Total Value</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(totalValue)}</div>
          </CardContent>
        </Card>
      </div>

      {/* Status filter + DataTable */}
      <div className="flex items-center gap-2">
        <Select value={tab} onValueChange={(v) => setTab(v as TabValue)}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Contracts</CardTitle>
          <CardDescription>
            {contracts.length} contract{contracts.length !== 1 ? "s" : ""} found
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          <DataTable
            columns={columns as any}
            data={contracts as any}
            searchKey="name"
            searchPlaceholder="Search contracts..."
            isLoading={isLoading}
          />
        </CardContent>
      </Card>
    </div>
  )
}
