"use client"

import { useParams, useRouter } from "next/navigation"
import { AlertDetailCard } from "@/components/shared/alerts/alert-detail-card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { useAlert, useResolveAlert, useDismissAlert, useMarkAlertRead } from "@/hooks/use-alerts"
import { alertTypeIconConfig, alertSeverityBadgeConfig, alertColorBg, statusColors } from "@/components/shared/alerts/alert-config"
import { ArrowLeft, AlertTriangle } from "lucide-react"
import { formatDistanceToNow } from "date-fns"
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
        <AlertTriangle className="h-12 w-12 text-muted-foreground" />
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

  const typeConfig = alertTypeIconConfig[alert.alertType]
  const severityConfig = alertSeverityBadgeConfig[alert.severity]
  const Icon = typeConfig?.icon ?? AlertTriangle
  const colorClasses = alertColorBg[alert.alertType] ?? "text-muted-foreground bg-muted"

  const handleMarkResolved = () => {
    resolve.mutate(alert.id)
    router.push("/dashboard/alerts")
  }

  const handleDismiss = () => {
    dismiss.mutate(alert.id)
    router.push("/dashboard/alerts")
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/dashboard/alerts">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${colorClasses}`}>
              <Icon className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">{alert.title}</h1>
              <p className="text-muted-foreground">
                {formatDistanceToNow(new Date(alert.createdAt), { addSuffix: true })}
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {severityConfig && (
            <Badge className={severityConfig.className}>
              {severityConfig.label.toLowerCase()} priority
            </Badge>
          )}
          <Badge className={statusColors[alert.status] ?? ""}>
            {alert.status.replace("_", " ")}
          </Badge>
        </div>
      </div>

      {/* Alert Details */}
      <AlertDetailCard
        alert={alert}
        onResolve={handleMarkResolved}
        onDismiss={handleDismiss}
      />
    </div>
  )
}
