"use client"

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
  const queryClient = useQueryClient()
  const { data } = useQuery({
    queryKey: ["my-notifications"],
    queryFn: () => getMyNotifications(),
    refetchInterval: 30_000,
  })
  const markRead = useMutation({
    mutationFn: (id: string) => markNotificationRead(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["my-notifications"] }),
  })
  const markAll = useMutation({
    mutationFn: () => markAllNotificationsRead(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["my-notifications"] }),
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
                if (n.actionUrl) window.open(n.actionUrl, "_blank")
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
