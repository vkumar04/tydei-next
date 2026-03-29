"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { DataTable } from "@/components/shared/tables/data-table"
import { getPOColumns } from "./po-columns"
import { usePurchaseOrders } from "@/hooks/use-purchase-orders"
import type { POStatus } from "@prisma/client"

interface POListProps {
  facilityId: string
}

const STATUS_OPTIONS: { label: string; value: POStatus | "all" }[] = [
  { label: "All", value: "all" },
  { label: "Draft", value: "draft" },
  { label: "Pending", value: "pending" },
  { label: "Approved", value: "approved" },
  { label: "Sent", value: "sent" },
  { label: "Completed", value: "completed" },
]

export function POList({ facilityId }: POListProps) {
  const router = useRouter()
  const [status, setStatus] = useState<POStatus | "all">("all")

  const { data, isLoading } = usePurchaseOrders(facilityId, {
    status: status === "all" ? undefined : status,
  })

  const columns = getPOColumns((id) => router.push(`/dashboard/purchase-orders/${id}`))

  return (
    <div className="space-y-4">
      <DataTable
        columns={columns}
        data={(data?.orders ?? []) as never[]}
        searchKey="poNumber"
        searchPlaceholder="Search POs..."
        isLoading={isLoading}
        filterComponent={
          <Select value={status} onValueChange={(v) => setStatus(v as POStatus | "all")}>
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />
    </div>
  )
}
