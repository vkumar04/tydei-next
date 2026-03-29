"use client"

import { History, FileSpreadsheet } from "lucide-react"
import { useCOGImportHistory } from "@/hooks/use-cog"
import { formatDate } from "@/lib/formatting"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
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
        title="No Uploaded Files"
        description="Import COG data to see upload history here"
      />
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileSpreadsheet className="h-5 w-5" />
          Uploaded COG Files
        </CardTitle>
        <CardDescription>
          Purchase order and invoice files imported into the system
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>File Name</TableHead>
              <TableHead>Upload Date</TableHead>
              <TableHead className="text-right">Records</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((entry, i) => (
              <TableRow key={i}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium">
                      COG Import - {formatDate(entry.date)}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {formatDate(entry.date)}
                </TableCell>
                <TableCell className="text-right">
                  {entry.recordCount.toLocaleString()}
                </TableCell>
                <TableCell>
                  <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300">
                    Processed
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
