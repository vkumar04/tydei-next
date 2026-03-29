"use client"

import { History } from "lucide-react"
import { useCOGImportHistory } from "@/hooks/use-cog"
import { formatDate } from "@/lib/formatting"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { EmptyState } from "@/components/shared/empty-state"
import { Skeleton } from "@/components/ui/skeleton"

interface COGUploadHistoryProps {
  facilityId: string
}

export function COGUploadHistory({ facilityId }: COGUploadHistoryProps) {
  const { data, isLoading } = useCOGImportHistory(facilityId)

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    )
  }

  if (!data || data.length === 0) {
    return (
      <EmptyState
        icon={History}
        title="No Import History"
        description="Import COG data to see upload history here"
      />
    )
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead className="text-right">Records</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((entry, i) => (
            <TableRow key={i}>
              <TableCell>{formatDate(entry.date)}</TableCell>
              <TableCell className="text-right">
                {entry.recordCount}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
