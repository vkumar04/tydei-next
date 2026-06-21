"use client"

import { Fragment } from "react"
import { MoreHorizontal, type LucideIcon } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"

interface TableAction {
  label: string
  icon?: LucideIcon
  onClick: () => void
  variant?: "default" | "destructive"
  /** Render a `<DropdownMenuSeparator>` immediately before this item. */
  separatorBefore?: boolean
}

interface TableActionMenuProps {
  actions: TableAction[]
  /**
   * Optional header label (with a trailing separator) above the items —
   * e.g. "Actions". Mirrors the hand-rolled column dropdowns.
   */
  label?: string
  /**
   * Stop click propagation on the trigger, content, and each item. Required
   * when the row itself navigates on click so menu interactions don't also
   * fire the row handler.
   */
  stopPropagation?: boolean
  /** Trigger button size (defaults to the compact `icon-xs`). */
  triggerSize?: "icon-xs" | "icon" | "sm"
  /** Extra classes on the trigger button. */
  triggerClassName?: string
}

export function TableActionMenu({
  actions,
  label,
  stopPropagation = false,
  triggerSize = "icon-xs",
  triggerClassName,
}: TableActionMenuProps) {
  const stop = stopPropagation
    ? (e: { stopPropagation: () => void }) => e.stopPropagation()
    : undefined
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild onClick={stop}>
        <Button variant="ghost" size={triggerSize} className={triggerClassName}>
          <MoreHorizontal className="size-4" />
          <span className="sr-only">Actions</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={stop}>
        {label && (
          <>
            <DropdownMenuLabel>{label}</DropdownMenuLabel>
            <DropdownMenuSeparator />
          </>
        )}
        {actions.map((action) => (
          <Fragment key={action.label}>
            {action.separatorBefore && <DropdownMenuSeparator />}
            <DropdownMenuItem
              onClick={(e) => {
                if (stop) e.stopPropagation()
                action.onClick()
              }}
              variant={action.variant}
            >
              {action.icon && <action.icon className="size-4" />}
              {action.label}
            </DropdownMenuItem>
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
