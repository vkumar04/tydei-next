"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { DataTable } from "@/components/shared/tables/data-table"
import { getVendorContractColumns } from "./vendor-contract-columns"
import { useVendorContracts } from "@/hooks/use-vendor-contracts"
import type { ContractStatus } from "@prisma/client"

interface VendorContractListProps {
  vendorId: string
}

const TABS: { label: string; value: ContractStatus | "all" }[] = [
  { label: "All", value: "all" },
  { label: "Active", value: "active" },
  { label: "Pending", value: "pending" },
  { label: "Expired", value: "expired" },
]

export function VendorContractList({ vendorId }: VendorContractListProps) {
  const router = useRouter()
  const [tab, setTab] = useState<ContractStatus | "all">("all")

  const { data, isLoading } = useVendorContracts(vendorId, {
    status: tab === "all" ? undefined : tab,
  })

  const columns = getVendorContractColumns((id) =>
    router.push(`/vendor/contracts/${id}`)
  )

  return (
    <div className="space-y-4">
      <Tabs value={tab} onValueChange={(v) => setTab(v as ContractStatus | "all")}>
        <TabsList>
          {TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>{t.label}</TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <DataTable
        columns={columns}
        data={data?.contracts ?? []}
        searchKey="name"
        searchPlaceholder="Search contracts..."
        isLoading={isLoading}
      />
    </div>
  )
}
