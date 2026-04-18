"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { AlertTriangle, ArrowLeft } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import {
  useAlert,
  useDismissAlert,
  useMarkAlertRead,
  useResolveAlert,
} from "@/hooks/use-alerts"

import { AlertDetailHeader } from "./alert-detail-header"
import { AlertDetailMetadata } from "./alert-detail-metadata"
import { AlertDetailOffContractItems } from "./alert-detail-off-contract-items"
import { AlertDetailTierProgress } from "./alert-detail-tier-progress"
import { AlertDetailActions } from "./alert-detail-actions"

interface AlertDetailClientProps {
  alertId: string
}

const KNOWN_TYPES = new Set([
  "off_contract",
  "expiring_contract",
  "tier_threshold",
  "rebate_due",
  "payment_due",
  "pricing_error",
  "compliance",
])

export function AlertDetailClient({ alertId }: AlertDetailClientProps) {
  const router = useRouter()
  const { data: alert, isLoading, isError } = useAlert(alertId)

  const resolve = useResolveAlert()
  const dismiss = useDismissAlert()
  const markRead = useMarkAlertRead()

  // Mark as read on first view.
  useEffect(() => {
    if (alert && alert.status === "new_alert") {
      markRead.mutate(alert.id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alert?.id])

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-48" />
        <div className="grid gap-6 lg:grid-cols-3">
          <Skeleton className="h-[300px] rounded-xl lg:col-span-2" />
          <Skeleton className="h-[300px] rounded-xl" />
        </div>
      </div>
    )
  }

  if (isError || !alert) {
    return <AlertNotFound />
  }

  if (!KNOWN_TYPES.has(alert.alertType)) {
    return <UnknownAlertType />
  }

  const metadata = (alert.metadata ?? {}) as Record<string, unknown>
  const isPending = resolve.isPending || dismiss.isPending

  const handleResolve = () => {
    resolve.mutate(alert.id, {
      onSuccess: () => router.push("/dashboard/alerts"),
    })
  }

  const handleDismiss = () => {
    dismiss.mutate(alert.id, {
      onSuccess: () => router.push("/dashboard/alerts"),
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <AlertDetailHeader
        alert={{
          title: alert.title,
          alertType: alert.alertType,
          severity: alert.severity,
          status: alert.status,
          createdAt: new Date(alert.createdAt),
        }}
      />

      {alert.description ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm">{alert.description}</p>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <AlertDetailMetadata
            metadata={metadata}
            vendorName={alert.vendor?.name ?? null}
            facilityName={alert.facility?.name ?? null}
            contractName={alert.contract?.name ?? null}
            contractExpirationDate={
              alert.contract?.expirationDate
                ? new Date(alert.contract.expirationDate)
                : null
            }
          />

          {alert.alertType === "off_contract" ? (
            <AlertDetailOffContractItems metadata={metadata} />
          ) : null}

          {alert.alertType === "tier_threshold" ? (
            <AlertDetailTierProgress metadata={metadata} />
          ) : null}
        </div>

        <div className="space-y-6">
          <AlertDetailActions
            alertType={alert.alertType}
            status={alert.status}
            actionLink={alert.actionLink}
            isPending={isPending}
            onResolve={handleResolve}
            onDismiss={handleDismiss}
          />
        </div>
      </div>
    </div>
  )
}

function AlertNotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[400px] gap-4 text-center">
      <AlertTriangle className="h-12 w-12 text-muted-foreground" />
      <h2 className="text-xl font-semibold">Alert Not Found</h2>
      <p className="text-muted-foreground max-w-md">
        The alert you are looking for does not exist, has been dismissed, or you
        do not have permission to view it.
      </p>
      <Button asChild>
        <Link href="/dashboard/alerts">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Alerts
        </Link>
      </Button>
    </div>
  )
}

function UnknownAlertType() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[400px] gap-4 text-center">
      <AlertTriangle className="h-12 w-12 text-muted-foreground" />
      <h2 className="text-xl font-semibold">Unknown alert type</h2>
      <p className="text-muted-foreground max-w-md">
        This alert could not be rendered because its type is not recognized by
        the current build.
      </p>
      <Button asChild variant="outline">
        <Link href="/dashboard/alerts">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Alerts
        </Link>
      </Button>
    </div>
  )
}
