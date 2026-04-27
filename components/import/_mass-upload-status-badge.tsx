"use client"

import {
  ClockIcon,
  Loader2Icon,
  HelpCircleIcon,
  CheckCircle2Icon,
  AlertCircleIcon,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import type { QueuedDocument } from "./_mass-upload-types"

/** Renders a status badge for a queued document. Pure — no component state. */
export function renderStatusBadge(status: QueuedDocument["status"]): React.ReactNode {
  switch (status) {
    case "pending":
      return (
        <Badge variant="outline" className="gap-1">
          <ClockIcon className="h-3 w-3" /> Pending
        </Badge>
      )
    case "classifying":
      return (
        <Badge variant="secondary" className="gap-1">
          <Loader2Icon className="h-3 w-3 animate-spin" /> Classifying
        </Badge>
      )
    case "needs_input":
      return (
        <Badge variant="default" className="gap-1 bg-amber-500">
          <HelpCircleIcon className="h-3 w-3" /> Needs Input
        </Badge>
      )
    case "extracting":
      return (
        <Badge variant="secondary" className="gap-1">
          <Loader2Icon className="h-3 w-3 animate-spin" /> Extracting
        </Badge>
      )
    case "processing":
      return (
        <Badge variant="secondary" className="gap-1">
          <Loader2Icon className="h-3 w-3 animate-spin" /> Processing
        </Badge>
      )
    case "completed":
      return (
        <Badge variant="default" className="gap-1 bg-green-500">
          <CheckCircle2Icon className="h-3 w-3" /> Done
        </Badge>
      )
    case "error":
      return (
        <Badge variant="destructive" className="gap-1">
          <AlertCircleIcon className="h-3 w-3" /> Error
        </Badge>
      )
    default:
      return null
  }
}
