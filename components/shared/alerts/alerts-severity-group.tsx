"use client"

import { useState } from "react"
import { ChevronDown } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"

import { alertSeverityBadgeConfig } from "./alert-config"

const SEVERITY_LABEL: Record<string, string> = {
  high: "High priority",
  medium: "Medium priority",
  low: "Low priority",
}

const SEVERITY_DOT: Record<string, string> = {
  high: "bg-red-500",
  medium: "bg-amber-500",
  low: "bg-slate-400",
}

interface AlertsSeverityGroupProps {
  severity: "high" | "medium" | "low"
  count: number
  defaultOpen?: boolean
  children: React.ReactNode
}

export function AlertsSeverityGroup({
  severity,
  count,
  defaultOpen = true,
  children,
}: AlertsSeverityGroupProps) {
  const [open, setOpen] = useState(defaultOpen)
  const badgeConfig = alertSeverityBadgeConfig[severity]

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="sticky top-0 z-10 flex w-full items-center gap-2 border-b bg-muted/60 px-4 py-2 text-left backdrop-blur transition-colors hover:bg-muted">
        <span
          className={cn("h-2 w-2 rounded-full", SEVERITY_DOT[severity])}
          aria-hidden
        />
        <span className="text-sm font-medium">
          {SEVERITY_LABEL[severity] ?? severity}
        </span>
        <Badge
          className={cn("ml-1 tabular-nums", badgeConfig?.className)}
          variant="secondary"
        >
          {count}
        </Badge>
        <ChevronDown
          className={cn(
            "ml-auto h-4 w-4 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="divide-y">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  )
}
