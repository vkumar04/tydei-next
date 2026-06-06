"use client"

import Link from "next/link"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useVendorPendingContracts } from "@/hooks/use-pending-contracts"
import { formatDate, formatCurrency } from "@/lib/formatting"
import { FileText, Pencil, Plus } from "lucide-react"
import type { PendingContractStatus } from "@/lib/generated/prisma/client"

interface VendorPendingContractsListProps {
  vendorId: string
}

const STATUS_META: Record<
  PendingContractStatus,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline"; className?: string }
> = {
  draft: { label: "Draft", variant: "secondary" },
  submitted: { label: "Submitted", variant: "default" },
  approved: {
    label: "Approved",
    variant: "outline",
    className: "border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  },
  rejected: { label: "Rejected", variant: "destructive" },
  revision_requested: {
    label: "Revision Requested",
    variant: "outline",
    className: "border-transparent bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  },
  withdrawn: { label: "Withdrawn", variant: "secondary" },
}

export function VendorPendingContractsList({ vendorId }: VendorPendingContractsListProps) {
  const { data: pending, isLoading } = useVendorPendingContracts(vendorId)

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
    )
  }

  if (!pending?.length) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <FileText className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No contract submissions yet.</p>
          <Button asChild size="sm">
            <Link href="/vendor/contracts/new">
              <Plus className="size-4" /> Submit a Contract
            </Link>
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-3">
      {pending.map((pc) => {
        const meta = STATUS_META[pc.status]
        const showFeedback =
          !!pc.reviewNotes &&
          (pc.status === "rejected" || pc.status === "revision_requested")

        return (
          <Card key={pc.id} className="transition-colors hover:bg-muted/50">
            <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{pc.contractName}</span>
                  <Badge variant={meta.variant} className={meta.className}>
                    {meta.label}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  {pc.facility?.name ?? pc.facilityName ?? "Unassigned facility"}
                  {" · "}
                  <span className="capitalize">{pc.contractType.replace(/_/g, " ")}</span>
                  {" · Submitted "}
                  {formatDate(pc.submittedAt)}
                  {pc.totalValue != null ? ` · ${formatCurrency(Number(pc.totalValue))}` : ""}
                </p>
                {showFeedback && (
                  <div className="mt-2 rounded-md bg-muted/60 p-3 text-sm">
                    <p className="font-medium text-foreground">Reviewer feedback</p>
                    <p className="mt-0.5 text-muted-foreground">{pc.reviewNotes}</p>
                  </div>
                )}
              </div>
              {pc.status === "revision_requested" && (
                <Button asChild variant="outline" size="sm" className="shrink-0">
                  <Link href={`/vendor/contracts/pending/${pc.id}/edit`}>
                    <Pencil className="size-4" /> Edit
                  </Link>
                </Button>
              )}
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
