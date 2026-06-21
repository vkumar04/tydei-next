"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"

import {
  useAlerts,
  useBulkUpdateAlerts,
  useDismissAlert,
  useMarkAllAlertsRead,
  useResolveAlert,
} from "@/hooks/use-alerts"
import type { AlertFilters } from "@/lib/validators/alerts"

import { AlertsHero } from "./alerts-hero"
import { AlertsInbox } from "./alerts-inbox"
import type { AlertRowItem } from "./alerts-row"
import type { StatusFilterValue } from "./alerts-toolbar"

interface AlertsListClientProps {
  facilityId: string
}

const PAGE_SIZE = 100

function serverStatusFor(
  status: StatusFilterValue,
): AlertFilters["status"] | undefined {
  switch (status) {
    case "resolved":
      return "resolved"
    case "dismissed":
      return "dismissed"
    case "open":
    case "all":
    default:
      return undefined
  }
}

export function AlertsListClient({ facilityId }: AlertsListClientProps) {
  const router = useRouter()
  const [statusFilter, setStatusFilter] = useState<StatusFilterValue>("open")

  const { data, isLoading } = useAlerts(facilityId, {
    status: serverStatusFor(statusFilter),
    pageSize: PAGE_SIZE,
  })

  const resolve = useResolveAlert()
  const dismiss = useDismissAlert()
  const bulkUpdate = useBulkUpdateAlerts()
  const markAllRead = useMarkAllAlertsRead()

  const alerts = useMemo(
    () => (data?.alerts ?? []) as AlertRowItem[],
    [data?.alerts],
  )

  const summary = useMemo(() => {
    const counts = data?.counts
    return {
      offContract: counts?.byType?.off_contract ?? 0,
      expiring: counts?.byType?.expiring_contract ?? 0,
      rebates: counts?.byType?.rebate_due ?? 0,
      unread: counts?.unread ?? 0,
      total: counts?.activeTotal ?? 0,
    }
  }, [data?.counts])

  return (
    <div className="flex flex-col gap-6">
      <AlertsHero
        offContractCount={summary.offContract}
        expiringCount={summary.expiring}
        rebatesDueCount={summary.rebates}
        totalUnresolved={summary.total}
        unreadCount={summary.unread}
        onMarkAllRead={() => markAllRead.mutate()}
        isMarkingAllRead={markAllRead.isPending}
      />

      <AlertsInbox
        alerts={alerts}
        total={data?.total ?? 0}
        isLoading={isLoading}
        statusFilter={statusFilter}
        onStatusChange={setStatusFilter}
        onResolve={(id) => resolve.mutate(id)}
        onDismiss={(id) => dismiss.mutate(id)}
        onBulkResolve={(ids) =>
          bulkUpdate.mutate({ alertIds: ids, action: "resolve" })
        }
        onBulkDismiss={(ids) =>
          bulkUpdate.mutate({ alertIds: ids, action: "dismiss" })
        }
        onBulkMarkRead={(ids) =>
          bulkUpdate.mutate({ alertIds: ids, action: "mark_read" })
        }
        isBulkPending={bulkUpdate.isPending}
        onNavigate={(id) => router.push(`/dashboard/alerts/${id}`)}
        detailHrefFor={(a) => `/dashboard/alerts/${a.id}`}
      />
    </div>
  )
}
