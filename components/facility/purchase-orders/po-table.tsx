"use client"

import { useRouter } from "next/navigation"
import {
  Building2,
  Calendar,
  CheckCircle2,
  Copy,
  Download,
  Eye,
  FileText,
  MoreHorizontal,
  Package,
  Send,
  XCircle,
} from "lucide-react"
import type { POStatus } from "@prisma/client"
import { Button } from "@/components/ui/button"
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
import { StatusBadge } from "@/components/shared/badges/status-badge"
import { poStatusConfig } from "@/lib/constants"
import { formatCurrency, formatDate } from "@/lib/formatting"

export interface POTableRow {
  id: string
  poNumber: string
  vendor: { name: string }
  contract: { name: string } | null
  orderDate: Date | string
  totalCost: unknown
  status: string
  _count: { lineItems: number }
}

export interface POTableProps {
  orders: POTableRow[]
  isLoading: boolean
  onUpdateStatus: (id: string, status: POStatus) => void
}

export function POTable({ orders, isLoading, onUpdateStatus }: POTableProps) {
  const router = useRouter()

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    )
  }

  if (orders.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <p className="text-sm text-muted-foreground">
          No purchase orders match the current filters.
        </p>
      </div>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>PO ID</TableHead>
          <TableHead>Vendor</TableHead>
          <TableHead>Contract</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Created</TableHead>
          <TableHead>Items</TableHead>
          <TableHead className="text-right">Total</TableHead>
          <TableHead className="w-[80px]">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {orders.map((po) => (
          <TableRow key={po.id}>
            <TableCell className="font-medium">{po.poNumber}</TableCell>
            <TableCell>
              <div className="flex items-center gap-2">
                <Building2 className="h-4 w-4 text-muted-foreground" />
                {po.vendor.name}
              </div>
            </TableCell>
            <TableCell>
              {po.contract ? (
                <span className="text-sm">{po.contract.name}</span>
              ) : (
                <span className="text-xs uppercase tracking-wider text-muted-foreground">
                  Off-contract
                </span>
              )}
            </TableCell>
            <TableCell>
              <StatusBadge status={po.status} config={poStatusConfig} />
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
            <TableCell className="text-right font-medium tabular-nums">
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
                      router.push(`/dashboard/purchase-orders/${po.id}`)
                    }
                  >
                    <Eye className="mr-2 h-4 w-4" />
                    View Details
                  </DropdownMenuItem>
                  {po.status === "draft" && (
                    <>
                      <DropdownMenuItem
                        onClick={() =>
                          router.push(`/dashboard/purchase-orders/${po.id}`)
                        }
                      >
                        <FileText className="mr-2 h-4 w-4" />
                        Edit Draft
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() =>
                          onUpdateStatus(po.id, "sent" as POStatus)
                        }
                      >
                        <Send className="mr-2 h-4 w-4" />
                        Send to Vendor
                      </DropdownMenuItem>
                    </>
                  )}
                  {(po.status === "sent" || po.status === "approved") && (
                    <DropdownMenuItem
                      onClick={() =>
                        onUpdateStatus(po.id, "completed" as POStatus)
                      }
                    >
                      <CheckCircle2 className="mr-2 h-4 w-4" />
                      Mark Completed
                    </DropdownMenuItem>
                  )}
                  {po.status !== "completed" && po.status !== "cancelled" && (
                    <DropdownMenuItem
                      onClick={() =>
                        onUpdateStatus(po.id, "cancelled" as POStatus)
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
                      router.push(`/dashboard/purchase-orders/new?from=${po.id}`)
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
  )
}
