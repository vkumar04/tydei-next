"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { DataTable } from "@/components/shared/tables/data-table"
import { getVendorContractColumns } from "./vendor-contract-columns"
import { useVendorContracts } from "@/hooks/use-vendor-contracts"
import { formatCurrency } from "@/lib/formatting"
import { FileStack, CheckCircle2, Clock, DollarSign } from "lucide-react"
import type { ContractStatus } from "@prisma/client"

interface VendorContractListProps {
  vendorId: string
}

const TABS: { label: string; value: ContractStatus | "all" }[] = [
  { label: "All", value: "all" },
  { label: "Draft", value: "draft" },
  { label: "Submitted", value: "pending" },
  { label: "Active", value: "active" },
  { label: "Expired", value: "expired" },
]

export function VendorContractList({ vendorId }: VendorContractListProps) {
  const router = useRouter()
  const [tab, setTab] = useState<ContractStatus | "all">("all")

  // Always fetch the full set for stats
  const { data: allData } = useVendorContracts(vendorId, { status: undefined })
  const allContracts = allData?.contracts ?? []

  const { data, isLoading } = useVendorContracts(vendorId, {
    status: tab === "all" ? undefined : tab,
  })

  const contracts = data?.contracts ?? []

  const columns = getVendorContractColumns((id) =>
    router.push(`/vendor/contracts/${id}`)
  )

  // Compute stats from the full (unfiltered) data set
  const activeCount = allContracts.filter((c) => c.status === "active").length
  const pendingCount = allContracts.filter((c) => c.status === "pending").length
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

      {/* Tabs + DataTable */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as ContractStatus | "all")}>
        <TabsList>
          {TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>{t.label}</TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <Card>
        <CardHeader>
          <CardTitle>Contracts</CardTitle>
          <CardDescription>
            {contracts.length} contract{contracts.length !== 1 ? "s" : ""} found
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            data={contracts}
            searchKey="name"
            searchPlaceholder="Search contracts..."
            isLoading={isLoading}
          />
        </CardContent>
      </Card>
    </div>
  )
}
