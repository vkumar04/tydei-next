"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import {
  FileText,
  Clock,
  DollarSign,
  Package,
  Plus,
  ShoppingCart,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { DataTable } from "@/components/shared/tables/data-table"
import { getPOColumns } from "./po-columns"
import {
  usePurchaseOrders,
  usePOStats,
  useUpdatePOStatus,
  useFacilityVendors,
} from "@/hooks/use-purchase-orders"
import { formatCurrency } from "@/lib/formatting"
import type { POStatus } from "@prisma/client"

interface POListProps {
  facilityId: string
}

const STATUS_OPTIONS: { label: string; value: POStatus | "all" }[] = [
  { label: "All Statuses", value: "all" },
  { label: "Draft", value: "draft" },
  { label: "Pending", value: "pending" },
  { label: "Approved", value: "approved" },
  { label: "Sent", value: "sent" },
  { label: "Completed", value: "completed" },
  { label: "Cancelled", value: "cancelled" },
]

export function POList({ facilityId }: POListProps) {
  const router = useRouter()
  const [status, setStatus] = useState<POStatus | "all">("all")
  const [vendorId, setVendorId] = useState<string>("all")

  const { data, isLoading } = usePurchaseOrders(facilityId, {
    status: status === "all" ? undefined : status,
    vendorId: vendorId === "all" ? undefined : vendorId,
  })
  const { data: stats, isLoading: statsLoading } = usePOStats(facilityId)
  const { data: vendors } = useFacilityVendors(facilityId)
  const updateStatus = useUpdatePOStatus()

  const columns = getPOColumns(
    (id) => router.push(`/dashboard/purchase-orders/${id}`),
    {
      onUpdateStatus: (id, newStatus) =>
        updateStatus.mutate({ id, status: newStatus as POStatus }),
      onDuplicate: (id) => router.push(`/dashboard/purchase-orders/new?from=${id}`),
    }
  )

  const orders = (data?.orders ?? []) as never[]
  const isEmpty = !isLoading && orders.length === 0 && status === "all" && vendorId === "all"

  return (
    <div className="space-y-6">
      {/* Stat Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total POs"
          value={stats?.totalPOs}
          icon={<FileText className="size-4 text-muted-foreground" />}
          loading={statsLoading}
        />
        <StatCard
          title="Pending Approval"
          value={stats?.pendingApproval}
          icon={<Clock className="size-4 text-muted-foreground" />}
          loading={statsLoading}
          valueClassName="text-yellow-600"
        />
        <StatCard
          title="Total Value"
          value={stats ? formatCurrency(stats.totalValue) : undefined}
          icon={<DollarSign className="size-4 text-muted-foreground" />}
          loading={statsLoading}
        />
        <StatCard
          title="Total Items"
          value={stats?.totalItems}
          icon={<Package className="size-4 text-muted-foreground" />}
          loading={statsLoading}
        />
      </div>

      {/* Empty State */}
      {isEmpty ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="rounded-full bg-muted p-4 mb-4">
              <ShoppingCart className="size-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold mb-1">No purchase orders yet</h3>
            <p className="text-sm text-muted-foreground mb-6">
              Create your first purchase order to get started.
            </p>
            <Button asChild>
              <Link href="/dashboard/purchase-orders/new">
                <Plus className="size-4" /> Create PO
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <DataTable
          columns={columns}
          data={orders}
          searchKey="poNumber"
          searchPlaceholder="Search by PO number..."
          isLoading={isLoading}
          filterComponent={
            <div className="flex items-center gap-2">
              <Select
                value={status}
                onValueChange={(v) => setStatus(v as POStatus | "all")}
              >
                <SelectTrigger className="w-[160px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={vendorId}
                onValueChange={(v) => setVendorId(v)}
              >
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="All Vendors" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Vendors</SelectItem>
                  {(vendors ?? []).map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          }
        />
      )}
    </div>
  )
}

/* ─── Stat Card ─────────────────────────────────────────────────── */

function StatCard({
  title,
  value,
  icon,
  loading,
  valueClassName,
}: {
  title: string
  value: string | number | undefined
  icon: React.ReactNode
  loading: boolean
  valueClassName?: string
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-7 w-20" />
        ) : (
          <div className={`text-2xl font-bold ${valueClassName ?? ""}`}>
            {value ?? 0}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
