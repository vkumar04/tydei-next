"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import {
  FileText,
  Package,
  Plus,
  ShoppingCart,
  ScanLine,
  Download,
  Search,
  Filter,
  Building2,
  CheckCircle2,
  MoreHorizontal,
  Eye,
  Send,
  XCircle,
  Copy,
  Calendar,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Skeleton } from "@/components/ui/skeleton"
import {
  usePurchaseOrders,
  usePOStats,
  useUpdatePOStatus,
  useFacilityVendors,
} from "@/hooks/use-purchase-orders"
import { formatCurrency, formatDate } from "@/lib/formatting"
import { poStatusConfig } from "@/lib/constants"
import { StatusBadge } from "@/components/shared/badges/status-badge"
import { POCreateDialog } from "./po-create-form"
import { toast } from "sonner"
import type { POStatus } from "@prisma/client"

interface POListProps {
  facilityId: string
}

const STATUS_OPTIONS: { label: string; value: POStatus | "all" }[] = [
  { label: "All Status", value: "all" },
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
  const [searchQuery, setSearchQuery] = useState("")
  const [newPOOpen, setNewPOOpen] = useState(false)

  const { data, isLoading } = usePurchaseOrders(facilityId, {
    status: status === "all" ? undefined : status,
    vendorId: vendorId === "all" ? undefined : vendorId,
  })
  // Unfiltered orders for accurate client-side status stats
  const { data: allData } = usePurchaseOrders(facilityId, {})
  const { data: stats, isLoading: statsLoading } = usePOStats(facilityId)
  const { data: vendors } = useFacilityVendors(facilityId)
  const updateStatus = useUpdatePOStatus()

  const orders = (data?.orders ?? []) as Array<{
    id: string
    poNumber: string
    vendor: { name: string }
    contract: { name: string } | null
    orderDate: Date | string
    totalCost: unknown
    status: string
    _count: { lineItems: number }
  }>

  const allOrders = (allData?.orders ?? []) as typeof orders

  // Derived status-breakdown stats (matches v0 parity)
  const sentCount = allOrders.filter(
    (po) => po.status === "sent" || po.status === "approved"
  ).length
  const completedCount = allOrders.filter((po) => po.status === "completed").length
  const draftsCount = allOrders.filter((po) => po.status === "draft").length

  const filteredOrders = orders.filter((po) => {
    const q = searchQuery.toLowerCase()
    return (
      po.poNumber.toLowerCase().includes(q) ||
      po.vendor.name.toLowerCase().includes(q)
    )
  })

  const isEmpty =
    !isLoading && orders.length === 0 && status === "all" && vendorId === "all"

  // Map vendors to the format POCreateDialog expects
  const vendorList = (vendors ?? []).map((v: { id: string; name: string }) => ({
    id: v.id,
    name: v.name,
  }))

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Bill Only Purchase Orders</h1>
          <p className="text-muted-foreground">
            Create and track Bill Only POs for products used in procedures
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => toast.info("Scan feature coming soon")}
          >
            <ScanLine className="mr-2 h-4 w-4" />
            Scan PO
          </Button>
          <Button
            variant="outline"
            onClick={() => toast.info("Export coming soon")}
          >
            <Download className="mr-2 h-4 w-4" />
            Export
          </Button>
          <Button onClick={() => setNewPOOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            New Bill Only PO
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total PO Value
            </CardTitle>
          </CardHeader>
          <CardContent>
            {statsLoading ? (
              <Skeleton className="h-7 w-20" />
            ) : (
              <div className="text-2xl font-bold">
                {formatCurrency(stats?.totalValue ?? 0)}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Sent to Vendors
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">{sentCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Completed
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{completedCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Drafts
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{draftsCount}</div>
          </CardContent>
        </Card>
      </div>

      {/* Empty State */}
      {isEmpty ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="rounded-full bg-muted p-4 mb-4">
              <ShoppingCart className="size-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold mb-1">
              No purchase orders yet
            </h3>
            <p className="text-sm text-muted-foreground mb-6">
              Create your first purchase order to get started.
            </p>
            <Button onClick={() => setNewPOOpen(true)}>
              <Plus className="size-4" /> Create PO
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Filters */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex gap-4">
                <div className="flex-1 relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search by PO ID or vendor..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10"
                  />
                </div>
                <Select
                  value={status}
                  onValueChange={(v) => setStatus(v as POStatus | "all")}
                >
                  <SelectTrigger className="w-[180px]">
                    <Filter className="mr-2 h-4 w-4" />
                    <SelectValue placeholder="All Status" />
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
            </CardContent>
          </Card>

          {/* Orders Table */}
          <Card>
            <CardHeader>
              <CardTitle>
                Purchase Orders ({filteredOrders.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="space-y-3">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>PO ID</TableHead>
                      <TableHead>Vendor</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead>Items</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead className="w-[80px]">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredOrders.map((po) => (
                      <TableRow key={po.id}>
                        <TableCell className="font-medium">
                          {po.poNumber}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Building2 className="h-4 w-4 text-muted-foreground" />
                            {po.vendor.name}
                          </div>
                        </TableCell>
                        <TableCell>
                          <StatusBadge
                            status={po.status}
                            config={poStatusConfig}
                          />
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Calendar className="h-4 w-4 text-muted-foreground" />
                            {formatDate(po.orderDate)}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Package className="h-4 w-4 text-muted-foreground" />
                            {po._count.lineItems} items
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {formatCurrency(Number(po.totalCost ?? 0))}
                        </TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onClick={() =>
                                  router.push(
                                    `/dashboard/purchase-orders/${po.id}`
                                  )
                                }
                              >
                                <Eye className="mr-2 h-4 w-4" />
                                View Details
                              </DropdownMenuItem>
                              {po.status === "draft" && (
                                <>
                                  <DropdownMenuItem
                                    onClick={() =>
                                      router.push(
                                        `/dashboard/purchase-orders/${po.id}`
                                      )
                                    }
                                  >
                                    <FileText className="mr-2 h-4 w-4" />
                                    Edit Draft
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() =>
                                      updateStatus.mutate({
                                        id: po.id,
                                        status: "sent" as POStatus,
                                      })
                                    }
                                  >
                                    <Send className="mr-2 h-4 w-4" />
                                    Send to Vendor
                                  </DropdownMenuItem>
                                </>
                              )}
                              {(po.status === "sent" ||
                                po.status === "approved") && (
                                <DropdownMenuItem
                                  onClick={() =>
                                    updateStatus.mutate({
                                      id: po.id,
                                      status: "completed" as POStatus,
                                    })
                                  }
                                >
                                  <CheckCircle2 className="mr-2 h-4 w-4" />
                                  Mark Completed
                                </DropdownMenuItem>
                              )}
                              {po.status !== "completed" &&
                                po.status !== "cancelled" && (
                                  <DropdownMenuItem
                                    onClick={() =>
                                      updateStatus.mutate({
                                        id: po.id,
                                        status: "cancelled" as POStatus,
                                      })
                                    }
                                    className="text-destructive"
                                  >
                                    <XCircle className="mr-2 h-4 w-4" />
                                    Cancel PO
                                  </DropdownMenuItem>
                                )}
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={() =>
                                  router.push(
                                    `/dashboard/purchase-orders/new?from=${po.id}`
                                  )
                                }
                              >
                                <Copy className="mr-2 h-4 w-4" />
                                Duplicate
                              </DropdownMenuItem>
                              <DropdownMenuItem>
                                <Download className="mr-2 h-4 w-4" />
                                Download PDF
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* Create PO Dialog */}
      <POCreateDialog
        facilityId={facilityId}
        vendors={vendorList}
        open={newPOOpen}
        onOpenChange={setNewPOOpen}
      />
    </div>
  )
}
