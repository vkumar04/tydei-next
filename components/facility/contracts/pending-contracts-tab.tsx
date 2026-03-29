"use client"

import { useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { PendingReviewDialog } from "./pending-review-dialog"
import {
  useFacilityPendingContracts,
  useApprovePendingContract,
  useRejectPendingContract,
  useRequestRevision,
} from "@/hooks/use-pending-contracts"
import { formatDate, formatCurrency } from "@/lib/formatting"
import { Eye } from "lucide-react"
import type { PendingContract, Vendor } from "@prisma/client"

type PendingContractWithVendor = PendingContract & {
  vendor: Pick<Vendor, "id" | "name" | "logoUrl">
}

interface PendingContractsTabProps {
  facilityId: string
  userId: string
}

export function PendingContractsTab({ facilityId, userId }: PendingContractsTabProps) {
  const { data: pending, isLoading } = useFacilityPendingContracts(facilityId)
  const [reviewTarget, setReviewTarget] = useState<PendingContractWithVendor | null>(null)
  const approve = useApprovePendingContract()
  const reject = useRejectPendingContract()
  const revision = useRequestRevision()

  const isSubmitting = approve.isPending || reject.isPending || revision.isPending

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-xl" />
        ))}
      </div>
    )
  }

  if (!pending?.length) {
    return <p className="py-8 text-center text-sm text-muted-foreground">No pending contract submissions.</p>
  }

  return (
    <>
      <div className="space-y-3">
        {pending.map((pc) => (
          <Card key={pc.id} className="transition-colors hover:bg-muted/50">
            <CardContent className="flex items-center gap-4 p-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{pc.contractName}</span>
                  <Badge variant="secondary">Pending Review</Badge>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {pc.vendor.name} &middot; Submitted {formatDate(pc.submittedAt)}
                  {pc.totalValue ? ` &middot; ${formatCurrency(Number(pc.totalValue))}` : ""}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setReviewTarget(pc as PendingContractWithVendor)}
              >
                <Eye className="size-4" /> Review
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      {reviewTarget && (
        <PendingReviewDialog
          contract={reviewTarget}
          open={!!reviewTarget}
          onOpenChange={(open) => { if (!open) setReviewTarget(null) }}
          onApprove={() => {
            approve.mutate({ id: reviewTarget.id, reviewedBy: userId })
            setReviewTarget(null)
          }}
          onReject={(notes) => {
            reject.mutate({ id: reviewTarget.id, reviewedBy: userId, notes })
            setReviewTarget(null)
          }}
          onRequestRevision={(notes) => {
            revision.mutate({ id: reviewTarget.id, reviewedBy: userId, notes })
            setReviewTarget(null)
          }}
          isSubmitting={isSubmitting}
        />
      )}
    </>
  )
}
