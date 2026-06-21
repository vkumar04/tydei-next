"use client"

import { useRouter } from "next/navigation"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Bell, Check } from "lucide-react"
import {
  getMyNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/lib/actions/notifications/in-app"

/**
 * In-app notification bell (Charles 2026-04-25 audit follow-up).
 * Renders in both facility + vendor nav bars; the underlying
 * `getMyNotifications` action figures out which role you are.
 *
 * Polls every 30s for new notifications. The unread badge surfaces
 * the count; clicking a row marks it read AND navigates to its
 * actionUrl in a new tab so the user doesn't lose their current
 * context.
 */
export function NotificationBell() {
  const router = useRouter()
  const queryClient = useQueryClient()
  type NotificationsData = Awaited<ReturnType<typeof getMyNotifications>>
  const NOTIF_KEY = ["my-notifications"] as const
  const { data } = useQuery({
    queryKey: NOTIF_KEY,
    queryFn: () => getMyNotifications(),
    refetchInterval: 30_000,
  })

  const nowIso = () => new Date().toISOString()

  // Optimistic read-state: clear the badge/highlight immediately so the UI
  // doesn't wait on the server round-trip (or a navigation that closes the
  // dropdown mid-flight). Roll back on error; reconcile with the server on
  // settle (Vick 2026-06-21 "these don't clear when read").
  const markRead = useMutation({
    mutationFn: (id: string) => markNotificationRead(id),
    onMutate: async (id: string) => {
      await queryClient.cancelQueries({ queryKey: NOTIF_KEY })
      const prev = queryClient.getQueryData<NotificationsData>(NOTIF_KEY)
      if (prev) {
        queryClient.setQueryData<NotificationsData>(NOTIF_KEY, {
          rows: prev.rows.map((r) =>
            r.id === id && !r.readAt ? { ...r, readAt: nowIso() } : r,
          ),
          unreadCount: prev.rows.some((r) => r.id === id && !r.readAt)
            ? Math.max(0, prev.unreadCount - 1)
            : prev.unreadCount,
        })
      }
      return { prev }
    },
    onError: (_e, _id, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(NOTIF_KEY, ctx.prev)
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: NOTIF_KEY }),
  })
  const markAll = useMutation({
    mutationFn: () => markAllNotificationsRead(),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: NOTIF_KEY })
      const prev = queryClient.getQueryData<NotificationsData>(NOTIF_KEY)
      if (prev) {
        queryClient.setQueryData<NotificationsData>(NOTIF_KEY, {
          rows: prev.rows.map((r) => (r.readAt ? r : { ...r, readAt: nowIso() })),
          unreadCount: 0,
        })
      }
      return { prev }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(NOTIF_KEY, ctx.prev)
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: NOTIF_KEY }),
  })
  const unreadCount = data?.unreadCount ?? 0
  const rows = data?.rows ?? []

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={
            unreadCount > 0 ? `${unreadCount} unread notifications` : "Notifications"
          }
        >
          <Bell className="size-4" />
          {unreadCount > 0 && (
            <Badge
              variant="destructive"
              className="absolute -right-1 -top-1 h-4 min-w-4 rounded-full px-1 text-[10px]"
            >
              {unreadCount > 99 ? "99+" : unreadCount}
            </Badge>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <div className="flex items-center justify-between px-2 py-1">
          <DropdownMenuLabel className="px-0">Notifications</DropdownMenuLabel>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => markAll.mutate()}
              disabled={markAll.isPending}
            >
              <Check className="mr-1 size-3" /> Mark all read
            </Button>
          )}
        </div>
        <DropdownMenuSeparator />
        {rows.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-muted-foreground">
            No notifications yet.
          </div>
        ) : (
          rows.map((n) => (
            <DropdownMenuItem
              key={n.id}
              onSelect={(e) => {
                e.preventDefault()
                if (!n.readAt) markRead.mutate(n.id)
                if (n.actionUrl) {
                  // Charles 2026-04-25 audit C3: same-origin links
                  // navigate in-place via the router so the user
                  // doesn't accumulate a new tab per click. External
                  // (http/https) links still open in a new tab.
                  if (n.actionUrl.startsWith("/")) {
                    router.push(n.actionUrl)
                  } else {
                    window.open(n.actionUrl, "_blank")
                  }
                }
              }}
              className={`flex flex-col items-start gap-0.5 ${n.readAt ? "" : "bg-muted/50"}`}
            >
              <span className="font-medium text-sm">{n.title}</span>
              {n.body && (
                <span className="line-clamp-2 text-xs text-muted-foreground">
                  {n.body}
                </span>
              )}
              <span className="text-[10px] text-muted-foreground">
                {new Date(n.createdAt).toLocaleString()}
              </span>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
