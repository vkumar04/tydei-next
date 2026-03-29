"use client"

import { useParams, useRouter } from "next/navigation"
import { PageHeader } from "@/components/shared/page-header"
import { AlertDetailCard } from "@/components/shared/alerts/alert-detail-card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useAlert, useResolveAlert, useDismissAlert, useMarkAlertRead } from "@/hooks/use-alerts"
import { ArrowLeft, Check, X } from "lucide-react"
import { useEffect } from "react"

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

  if (!alert) return null

  return (
    <div className="space-y-6">
      <PageHeader
        title="Alert Detail"
        action={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => router.push("/dashboard/alerts")}>
              <ArrowLeft className="mr-2 size-4" /> Back
            </Button>
            {alert.status !== "resolved" && (
              <Button size="sm" onClick={() => resolve.mutate(alert.id)}>
                <Check className="mr-2 size-4" /> Resolve
              </Button>
            )}
            {alert.status !== "dismissed" && (
              <Button size="sm" variant="outline" onClick={() => dismiss.mutate(alert.id)}>
                <X className="mr-2 size-4" /> Dismiss
              </Button>
            )}
          </div>
        }
      />
      <AlertDetailCard alert={alert} />
      {alert.actionLink && (
        <Button variant="outline" onClick={() => router.push(alert.actionLink!)}>
          View Related Entity
        </Button>
      )}
    </div>
  )
}
