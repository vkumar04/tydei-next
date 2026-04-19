"use client"

/**
 * Vendor-side renewal notes timeline (W1.8).
 *
 * READ-ONLY view of `RenewalNote` rows on a contract the vendor owns,
 * rendered as a chronological timeline (newest-first). The facility
 * side retains the composer / delete affordances — this surface is
 * purely for vendor visibility into facility context during renewal.
 *
 * Data source: `listRenewalNotesForVendor` (vendor-gated server action
 * added alongside this component — see `lib/actions/renewals/notes.ts`).
 * The query key matches the facility-side `["renewals", "notes", id]`
 * shape so a facility user writing a note invalidates both portals
 * when they're visible together in tests or E2E.
 */

import { useQuery } from "@tanstack/react-query"
import { formatDistanceToNow } from "date-fns"
import { MessageSquare, Loader2 } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { queryKeys } from "@/lib/query-keys"
import { listRenewalNotesForVendor } from "@/lib/actions/renewals/notes"
import {
  authorInitials,
  authorDisplayName,
} from "@/lib/renewals/renewal-note-display"

interface VendorRenewalNotesTimelineProps {
  contractId: string
}

export function VendorRenewalNotesTimeline({
  contractId,
}: VendorRenewalNotesTimelineProps) {
  const { data, isLoading, isError } = useQuery({
    queryKey: queryKeys.renewals.notes(contractId),
    queryFn: () => listRenewalNotesForVendor(contractId),
    enabled: contractId.length > 0,
  })

  if (isLoading) {
    return (
      <div className="space-y-2" data-testid="renewal-notes-loading">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    )
  }

  if (isError) {
    return (
      <div className="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
        <Loader2 className="mr-2 inline h-4 w-4" />
        Failed to load renewal notes.
      </div>
    )
  }

  if (!data || data.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-dashed p-6 text-sm text-muted-foreground">
        <MessageSquare className="h-4 w-4" />
        No renewal notes yet. The facility team will post context here
        during renewal.
      </div>
    )
  }

  return (
    <ol className="relative space-y-4 border-l border-muted pl-6">
      {data.map((n) => {
        const name = authorDisplayName(n.authorName)
        const initials = authorInitials(n.authorName, n.authorId)
        return (
          <li key={n.id} className="relative">
            {/* Timeline dot */}
            <span
              aria-hidden
              className="absolute -left-[30px] flex h-6 w-6 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground shadow"
            >
              {initials}
            </span>
            <Card>
              <CardContent className="space-y-2 p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">{name}</p>
                  <time
                    dateTime={new Date(n.createdAt).toISOString()}
                    className="text-xs text-muted-foreground"
                  >
                    {formatDistanceToNow(new Date(n.createdAt), {
                      addSuffix: true,
                    })}
                  </time>
                </div>
                <p className="whitespace-pre-wrap text-sm">{n.note}</p>
              </CardContent>
            </Card>
          </li>
        )
      })}
    </ol>
  )
}
