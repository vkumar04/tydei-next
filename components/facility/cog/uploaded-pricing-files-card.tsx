"use client"

import { useState } from "react"
import { FileText, Loader2, Trash2, Upload } from "lucide-react"
import { formatDate } from "@/lib/formatting"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  useDeletePricingFilesByVendor,
  useUploadedPricingFiles,
} from "@/hooks/use-pricing-files"

interface UploadedPricingFilesCardProps {
  facilityId: string
  onImport?: () => void
}

export function UploadedPricingFilesCard({
  facilityId,
  onImport,
}: UploadedPricingFilesCardProps) {
  const { data, isLoading } = useUploadedPricingFiles()
  const deleteMutation = useDeletePricingFilesByVendor()
  const [pendingVendor, setPendingVendor] = useState<{
    vendorId: string
    vendorName: string
    recordCount: number
  } | null>(null)

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    )
  }

  const rows = data ?? []

  if (rows.length === 0) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Uploaded Pricing Files</CardTitle>
            <CardDescription>
              Vendor pricing files used to match COG data
            </CardDescription>
          </div>
          {onImport ? (
            <Button onClick={onImport}>
              <Upload className="mr-2 h-4 w-4" />
              Import Data
            </Button>
          ) : null}
        </CardHeader>
        <CardContent>
          <EmptyState
            icon={FileText}
            title="No Pricing Files"
            description="Upload vendor pricing files to see them here"
          />
        </CardContent>
      </Card>
    )
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Uploaded Pricing Files</CardTitle>
            <CardDescription>
              Vendor pricing files used to match COG data. Deleting a row
              removes all pricing rows for that vendor at this facility.
            </CardDescription>
          </div>
          {onImport ? (
            <Button onClick={onImport}>
              <Upload className="mr-2 h-4 w-4" />
              Import Data
            </Button>
          ) : null}
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Vendor</TableHead>
                <TableHead>Latest Upload</TableHead>
                <TableHead>Effective</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead className="text-right">Unique Items</TableHead>
                <TableHead className="text-right">Rows</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[50px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const busy =
                  deleteMutation.isPending &&
                  deleteMutation.variables?.vendorId === row.vendorId
                return (
                  <TableRow key={row.vendorId}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4 text-muted-foreground" />
                        {row.vendorName}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(row.latestUploadDate)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {row.earliestEffectiveDate
                        ? formatDate(row.earliestEffectiveDate)
                        : "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {row.latestExpirationDate
                        ? formatDate(row.latestExpirationDate)
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      {row.uniqueItems.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">
                      {row.recordCount.toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300">
                        Active
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Delete pricing file for ${row.vendorName}`}
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() =>
                          setPendingVendor({
                            vendorId: row.vendorId,
                            vendorName: row.vendorName,
                            recordCount: row.recordCount,
                          })
                        }
                        disabled={busy}
                      >
                        {busy ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <AlertDialog
        open={!!pendingVendor}
        onOpenChange={(open) => {
          if (!open) setPendingVendor(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete pricing file?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingVendor ? (
                <>
                  This will permanently delete{" "}
                  {pendingVendor.recordCount.toLocaleString()} pricing rows
                  for <strong>{pendingVendor.vendorName}</strong> at this
                  facility. This action cannot be undone.
                </>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (!pendingVendor) return
                deleteMutation.mutate({
                  vendorId: pendingVendor.vendorId,
                  facilityId,
                })
                setPendingVendor(null)
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
