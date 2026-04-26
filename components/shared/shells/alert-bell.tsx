"use client"

import { useEffect, useRef } from "react"
import Link from "next/link"
import { TriangleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useQuery } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import { getUnreadAlertCount } from "@/lib/actions/alerts"
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
  const portalType = role === "vendor" ? "vendor" : "facility"
  const entityId = (role === "vendor" ? vendorId : facilityId) ?? ""

  const { data: count } = useQuery({
    queryKey: queryKeys.alerts.unreadCount(portalType, entityId),
    queryFn: () =>
      getUnreadAlertCount({
        facilityId: role !== "vendor" ? facilityId : undefined,
        vendorId: role === "vendor" ? vendorId : undefined,
        portalType,
      }),
    refetchInterval: 30_000,
    initialData: initialCount,
    enabled: !!entityId,
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
          <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[10px] text-destructive-foreground">
            {displayCount > 9 ? "9+" : displayCount}
          </span>
        )}
      </Button>
    </Link>
  )
}
