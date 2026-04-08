"use client"

import { useState } from "react"
import { History, FileSpreadsheet, Upload, FileText, Trash2, Loader2 } from "lucide-react"
import { useCOGImportHistory, useDeleteCOGFile } from "@/hooks/use-cog"
import { formatDate, formatCurrency } from "@/lib/formatting"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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

interface COGUploadHistoryProps {
  facilityId: string
  variant?: "cog" | "pricing"
  onImport?: () => void
}

export function COGUploadHistory({ facilityId, variant = "cog", onImport }: COGUploadHistoryProps) {
  const { data, isLoading } = useCOGImportHistory(facilityId)
  const deleteMutation = useDeleteCOGFile()
  const [deleteDate, setDeleteDate] = useState<string | null>(null)

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
        title={variant === "pricing" ? "No Pricing Files" : "No Uploaded Files"}
        description={
          variant === "pricing"
            ? "Upload vendor pricing files to see them here"
            : 'No files uploaded yet. Click "Import Data" to upload COG files.'
        }
      />
    )
  }

  const totalRecords = data.reduce((sum, f) => sum + f.recordCount, 0)
  const totalSpendImported = data.reduce((sum, f) => sum + (f.totalSpend ?? 0), 0)

  if (variant === "pricing") {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Uploaded Pricing Files</CardTitle>
            <CardDescription>
              Vendor pricing files used to match COG data
            </CardDescription>
          </div>
          <Button onClick={onImport}>
            <Upload className="mr-2 h-4 w-4" />
            Import Data
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Vendor</TableHead>
                <TableHead>File Name</TableHead>
                <TableHead>Linked Contract</TableHead>
                <TableHead>Upload Date</TableHead>
                <TableHead>Effective Date</TableHead>
                <TableHead className="text-right">Items</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[50px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((entry, i) => (
                <TableRow key={i}>
                  <TableCell className="font-medium">Vendor</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      Pricing Import - {formatDate(entry.date)}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="secondary"
                      className="bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200"
                    >
                      Not Linked
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(entry.date)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(entry.date)}
                  </TableCell>
                  <TableCell className="text-right">
                    {entry.recordCount.toLocaleString()}
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
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      onClick={() => setDeleteDate(entry.date)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    )
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5" />
              Uploaded COG Files
            </CardTitle>
            <CardDescription>
              Purchase order and invoice files imported into the system
            </CardDescription>
          </div>
          <Button onClick={onImport}>
            <Upload className="mr-2 h-4 w-4" />
            Import Data
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>File Name</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Upload Date</TableHead>
                <TableHead>Date Range</TableHead>
                <TableHead className="text-right">Records</TableHead>
                <TableHead className="text-right">Total Spend</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[50px]" />
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
                  <TableCell>
                    <Badge variant="outline">CSV</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(entry.date)}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {formatDate(entry.date)}
                  </TableCell>
                  <TableCell className="text-right">
                    {entry.recordCount.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {formatCurrency(entry.totalSpend ?? 0)}
                  </TableCell>
                  <TableCell>
                    <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300">
                      Processed
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      onClick={() => setDeleteDate(entry.date)}
                      disabled={deleteMutation.isPending}
                    >
                      {deleteMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Summary Stats for COG Files */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Total Files</p>
            <p className="text-2xl font-bold">{data.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Total Records</p>
            <p className="text-2xl font-bold">
              {totalRecords.toLocaleString()}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Total Spend Imported</p>
            <p className="text-2xl font-bold">{formatCurrency(totalSpendImported)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteDate} onOpenChange={() => setDeleteDate(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete COG File</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete all records imported on{" "}
              {deleteDate ? formatDate(deleteDate) : ""}. This action cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (deleteDate) {
                  deleteMutation.mutate(deleteDate)
                  setDeleteDate(null)
                }
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
