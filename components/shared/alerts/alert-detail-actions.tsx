"use client"

import Link from "next/link"
import { CheckCircle, ExternalLink, XCircle } from "lucide-react"
import type { AlertType } from "@prisma/client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"

interface AlertDetailActionsProps {
  alertType: AlertType
  status: string
  actionLink: string | null
  isPending: boolean
  onResolve: () => void
  onDismiss: () => void
}

const ACTION_LABELS: Record<string, string> = {
  off_contract: "View Purchase Order",
  expiring_contract: "View Contract",
  tier_threshold: "View Contract",
  rebate_due: "View Rebate Details",
  payment_due: "View Contract",
}

export function AlertDetailActions({
  alertType,
  status,
  actionLink,
  isPending,
  onResolve,
  onDismiss,
}: AlertDetailActionsProps) {
  const actionLabel = ACTION_LABELS[alertType] ?? "View Details"
  const isResolved = status === "resolved"
  const isDismissed = status === "dismissed"

  return (
    <Card>
      <CardHeader>
        <CardTitle>Actions</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {actionLink ? (
          <Button className="w-full" asChild>
            <Link href={actionLink}>
              <ExternalLink className="mr-2 h-4 w-4" />
              {actionLabel}
            </Link>
          </Button>
        ) : null}

        {!isResolved && !isDismissed ? (
          <Button
            variant="outline"
            className="w-full"
            disabled={isPending}
            onClick={onResolve}
          >
            <CheckCircle className="mr-2 h-4 w-4" />
            Mark as Resolved
          </Button>
        ) : null}

        {!isDismissed ? (
          <Button
            variant="ghost"
            className="w-full"
            disabled={isPending}
            onClick={onDismiss}
          >
            <XCircle className="mr-2 h-4 w-4" />
            Dismiss Alert
          </Button>
        ) : null}
      </CardContent>
    </Card>
  )
}
