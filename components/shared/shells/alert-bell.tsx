"use client"

import { useEffect, useRef } from "react"
import Link from "next/link"
import { TriangleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useQuery } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import { toast } from "sonner"
import type { PortalRole } from "@/lib/types"

interface AlertBellProps {
  role: PortalRole
  facilityId?: string
  vendorId?: string
  initialCount?: number
}

export function AlertBell({
  role,
  facilityId,
  vendorId,
  initialCount = 0,
}: AlertBellProps) {
  // `admin` is neither a facility nor a vendor. This collapsed it to
  // "facility", so an admin would call getOpenAlertCount({portalType:
  // "facility"}) -> requireFacility() -> redirect() and get bounced off the
  // page. It is inert today only because the admin layout happens to pass no
  // facilityId, leaving entityId empty and the query disabled — an accident,
  // not a guard. Make it explicit: the operator console has no alert scope.
  // (Same root cause as the NotificationBell bug, audit 2026-07-26.)
  const portalType = role === "vendor" ? "vendor" : "facility"
  const entityId = (role === "vendor" ? vendorId : facilityId) ?? ""
  const scopedToAnEntity = role !== "admin" && !!entityId

  const { data: count } = useQuery({
    queryKey: queryKeys.alerts.unreadCount(portalType, entityId),
    // Route Handler, NOT the Server Action — see app/api/alerts/unread-count.
    // A queued 30s poll keeps posting to the route that queued it after you
    // navigate away, and its response can commit that route's RSC payload.
    // The endpoint derives the portal scope from the session, so no ids are
    // sent: the previous facilityId/vendorId arguments were already
    // deprecated and ignored server-side.
    queryFn: async (): Promise<number> => {
      const res = await fetch("/api/alerts/unread-count")
      if (!res.ok) throw new Error(`Alert count failed: ${res.status}`)
      const body = (await res.json()) as { count: number }
      return body.count
    },
    refetchInterval: 30_000,
    initialData: initialCount,
    enabled: scopedToAnEntity,
  })

  const prevCountRef = useRef(initialCount)

  useEffect(() => {
    const prev = prevCountRef.current
    const current = count ?? 0
    prevCountRef.current = current

    if (current > prev && prev >= 0) {
      const diff = current - prev
      toast.info(
        `${diff} new alert${diff > 1 ? "s" : ""} received`,
        {
          action: {
            label: "View",
            onClick: () => {
              window.location.href =
                role === "vendor" ? "/vendor/alerts" : "/dashboard/alerts"
            },
          },
        }
      )
    }
  }, [count, role])

  const displayCount = count ?? 0
  const alertsHref = role === "vendor" ? "/vendor/alerts" : "/dashboard/alerts"

  return (
    <Link href={alertsHref} aria-label={`${displayCount} alerts`}>
      <Button variant="ghost" size="icon" className="relative h-9 w-9">
        <TriangleAlert className="h-4 w-4" />
        {displayCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] text-destructive-foreground">
            {displayCount}
          </span>
        )}
      </Button>
    </Link>
  )
}
