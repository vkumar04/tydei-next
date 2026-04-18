"use client"

import { Archive, Check, CheckCircle2 } from "lucide-react"

import { Button } from "@/components/ui/button"

interface AlertsBulkActionsProps {
  selectedCount: number
  isPending: boolean
  onMarkRead: () => void
  onResolve: () => void
  onDismiss: () => void
}

export function AlertsBulkActions({
  selectedCount,
  isPending,
  onMarkRead,
  onResolve,
  onDismiss,
}: AlertsBulkActionsProps) {
  if (selectedCount <= 0) return null

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-muted-foreground">
        {selectedCount} selected
      </span>
      <Button
        size="sm"
        variant="outline"
        disabled={isPending}
        onClick={onMarkRead}
      >
        <Check className="mr-1.5 h-3.5 w-3.5" />
        Mark Read
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={isPending}
        onClick={onResolve}
      >
        <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
        Resolve
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={isPending}
        onClick={onDismiss}
      >
        <Archive className="mr-1.5 h-3.5 w-3.5" />
        Dismiss
      </Button>
    </div>
  )
}
