"use client"

import type { PendingContract, Facility } from "@prisma/client"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { formatDate } from "@/lib/formatting"
import { Eye, Pencil, X } from "lucide-react"

type PendingContractWithFacility = PendingContract & {
  facility: Pick<Facility, "id" | "name"> | null
}

const STATUS_CONFIG: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  draft: { label: "Draft", variant: "outline" },
  submitted: { label: "Submitted", variant: "secondary" },
  approved: { label: "Approved", variant: "default" },
  rejected: { label: "Rejected", variant: "destructive" },
  revision_requested: { label: "Revision Requested", variant: "secondary" },
  withdrawn: { label: "Withdrawn", variant: "outline" },
}

interface PendingContractCardProps {
  contract: PendingContractWithFacility
  onView: () => void
  onEdit: () => void
  onWithdraw: () => void
}

export function PendingContractCard({ contract, onView, onEdit, onWithdraw }: PendingContractCardProps) {
  const cfg = STATUS_CONFIG[contract.status] ?? STATUS_CONFIG.draft

  return (
    <Card className="transition-colors hover:bg-muted/50">
      <CardContent className="flex items-center gap-4 p-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium">{contract.contractName}</span>
            <Badge variant={cfg.variant}>{cfg.label}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {contract.facility?.name ?? "No facility"} &middot; Submitted {formatDate(contract.submittedAt)}
          </p>
          {contract.reviewNotes && (
            <p className="mt-1 text-sm text-muted-foreground italic">{contract.reviewNotes}</p>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={onView} title="View">
            <Eye className="size-4" />
          </Button>
          {(contract.status === "draft" || contract.status === "revision_requested") && (
            <Button variant="ghost" size="icon" onClick={onEdit} title="Edit">
              <Pencil className="size-4" />
            </Button>
          )}
          {contract.status === "submitted" && (
            <Button variant="ghost" size="icon" onClick={onWithdraw} title="Withdraw">
              <X className="size-4" />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
