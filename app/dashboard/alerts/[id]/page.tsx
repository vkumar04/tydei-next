"use client"

import { useParams, useRouter } from "next/navigation"
import { AlertDetailCard } from "@/components/shared/alerts/alert-detail-card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useAlert, useResolveAlert, useDismissAlert, useMarkAlertRead } from "@/hooks/use-alerts"
import { ArrowLeft, CheckCircle, XCircle } from "lucide-react"
import { useEffect } from "react"
import Link from "next/link"

export default function AlertDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const { data: alert, isLoading } = useAlert(params.id)
  const resolve = useResolveAlert()
  const dismiss = useDismissAlert()
  const markRead = useMarkAlertRead()

  useEffect(() => {
    if (alert && alert.status === "new_alert") {
      markRead.mutate(alert.id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alert?.id])

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-[300px] rounded-xl" />
      </div>
    )
  }

  if (!alert) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
        <h2 className="text-xl font-semibold">Alert Not Found</h2>
        <p className="text-muted-foreground">The alert you are looking for does not exist.</p>
        <Button asChild>
          <Link href="/dashboard/alerts">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Alerts
          </Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Back button + action buttons header */}
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/dashboard/alerts">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Alerts
          </Link>
        </Button>
        <div className="flex items-center gap-2">
          {alert.status !== "resolved" && (
            <Button
              size="sm"
              onClick={() => {
                resolve.mutate(alert.id)
                router.push("/dashboard/alerts")
              }}
            >
              <CheckCircle className="mr-2 h-4 w-4" />
              Resolve
            </Button>
          )}
          {alert.status !== "dismissed" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                dismiss.mutate(alert.id)
                router.push("/dashboard/alerts")
              }}
            >
              <XCircle className="mr-2 h-4 w-4" />
              Dismiss
            </Button>
          )}
        </div>
      </div>

      {/* Alert detail card with all metadata */}
      <AlertDetailCard alert={alert} />

      {/* Related entity link */}
      {alert.actionLink && (
        <Button variant="outline" onClick={() => router.push(alert.actionLink!)}>
          View Related Entity
        </Button>
      )}
    </div>
  )
}
