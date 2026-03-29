"use client"

import type { ColumnDef } from "@tanstack/react-table"
import {
  Eye,
  MoreHorizontal,
  Send,
  CheckCircle2,
  XCircle,
  Copy,
  Download,
  FileText,
} from "lucide-react"
import { formatCurrency, formatDate } from "@/lib/formatting"
import { poStatusConfig } from "@/lib/constants"
import { StatusBadge } from "@/components/shared/badges/status-badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

type PORow = {
  id: string
  poNumber: string
  vendor: { name: string }
  contract: { name: string } | null
  orderDate: Date | string
  totalCost: unknown
  status: string
  _count: { lineItems: number }
}

export type { PORow }

export interface POColumnActions {
  onView: (id: string) => void
  onUpdateStatus?: (id: string, status: string) => void
  onDuplicate?: (id: string) => void
}

export function getPOColumns(
  onView: (id: string) => void,
  actions?: Omit<POColumnActions, "onView">
): ColumnDef<PORow>[] {
  return [
    { accessorKey: "poNumber", header: "PO #" },
    {
      accessorKey: "vendor.name",
      header: "Vendor",
      accessorFn: (row) => row.vendor.name,
    },
    {
      accessorKey: "orderDate",
      header: "Date",
      cell: ({ row }) => formatDate(row.original.orderDate),
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => (
        <StatusBadge status={row.original.status} config={poStatusConfig} />
      ),
    },
    {
      accessorKey: "totalCost",
      header: "Total",
      cell: ({ row }) => formatCurrency(Number(row.original.totalCost ?? 0)),
    },
    {
      accessorKey: "_count.lineItems",
      header: "Items",
      accessorFn: (row) => row._count.lineItems,
    },
    {
      id: "actions",
      cell: ({ row }) => {
        const po = row.original
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon">
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onView(po.id)}>
                <Eye className="mr-2 size-4" />
                View Details
              </DropdownMenuItem>
              {po.status === "draft" && (
                <>
                  <DropdownMenuItem onClick={() => onView(po.id)}>
                    <FileText className="mr-2 size-4" />
                    Edit Draft
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => actions?.onUpdateStatus?.(po.id, "sent")}
                  >
                    <Send className="mr-2 size-4" />
                    Send to Vendor
                  </DropdownMenuItem>
                </>
              )}
              {(po.status === "sent" || po.status === "approved") && (
                <DropdownMenuItem
                  onClick={() =>
                    actions?.onUpdateStatus?.(po.id, "completed")
                  }
                >
                  <CheckCircle2 className="mr-2 size-4" />
                  Mark Completed
                </DropdownMenuItem>
              )}
              {po.status !== "completed" && po.status !== "cancelled" && (
                <DropdownMenuItem
                  onClick={() =>
                    actions?.onUpdateStatus?.(po.id, "cancelled")
                  }
                  className="text-destructive"
                >
                  <XCircle className="mr-2 size-4" />
                  Cancel PO
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => actions?.onDuplicate?.(po.id)}
              >
                <Copy className="mr-2 size-4" />
                Duplicate
              </DropdownMenuItem>
              <DropdownMenuItem>
                <Download className="mr-2 size-4" />
                Download PDF
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )
      },
    },
  ]
}
