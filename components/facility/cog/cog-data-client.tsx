"use client"

import { useState, useEffect } from "react"
import { useSearchParams } from "next/navigation"
import {
  FileText,
  Upload,
  CheckCircle,
  AlertTriangle,
  Plus,
  CalendarIcon,
  FileStack,
  Trash2,
  RefreshCw,
} from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { format, parseISO } from "date-fns"
import { cn } from "@/lib/utils"
import { COGRecordsTable } from "@/components/facility/cog/cog-records-table"
import { PricingFilesTable } from "@/components/facility/cog/pricing-files-table"
import { COGUploadHistory } from "@/components/facility/cog/cog-upload-history"
import { COGImportDialog } from "@/components/facility/cog/cog-import-dialog"
import { PricingImportDialog } from "@/components/facility/cog/pricing-import-dialog"
import { COGManualEntry } from "@/components/facility/cog/cog-manual-entry"
import { MassUpload } from "@/components/import/mass-upload"
import { toast } from "sonner"
import { useCOGStats, useClearAllCOGRecords } from "@/hooks/use-cog"
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
import { formatCurrency } from "@/lib/formatting"
import { Skeleton } from "@/components/ui/skeleton"

interface COGDataClientProps {
  facilityId: string
}

export function COGDataClient({ facilityId }: COGDataClientProps) {
  const searchParams = useSearchParams()
  const [cogImportOpen, setCogImportOpen] = useState(false)

  // Auto-open import dialog when navigating from Import Data button
  useEffect(() => {
    if (searchParams.get("autoImport") === "true") {
      setCogImportOpen(true)
    }
  }, [searchParams])
  const [pricingImportOpen, setPricingImportOpen] = useState(false)
  const [manualEntryOpen, setManualEntryOpen] = useState(false)
  const [massUploadOpen, setMassUploadOpen] = useState(false)
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [clearAllOpen, setClearAllOpen] = useState(false)

  // Fetch aggregated stats from server (not from paginated records)
  const { data: stats, isPending: statsLoading, refetch: refetchStats } = useCOGStats(facilityId)
  const clearAllMutation = useClearAllCOGRecords()

  const totalSpend = stats?.totalSpend ?? 0
  const totalItems = stats?.totalItems ?? 0
  const onContractCount = stats?.onContractCount ?? 0
  const offContractCount = stats?.offContractCount ?? 0
  const totalSavings = totalSpend * 0.05
  const minPODate = stats?.minPODate ?? null
  const maxPODate = stats?.maxPODate ?? null

  return (
    <div className="flex flex-col gap-6">
      {/* Page header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-balance">COG Data</h1>
          <p className="text-muted-foreground">
            Manage your Cost of Goods data and vendor pricing files
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="destructive" onClick={() => setClearAllOpen(true)}>
            <Trash2 className="mr-2 h-4 w-4" />
            Clear All Data
          </Button>
          <Button variant="outline" onClick={() => setMassUploadOpen(true)}>
            <FileStack className="mr-2 h-4 w-4" />
            Mass Upload
          </Button>
          <Button variant="outline" onClick={() => {
            toast.info("Matching COG items to contracts...")
          }}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Match Pricing
          </Button>
          <Button variant="outline" onClick={() => setCogImportOpen(true)}>
            <Upload className="mr-2 h-4 w-4" />
            Import Data
          </Button>
          <Button onClick={() => setManualEntryOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add COG Entry
          </Button>
        </div>
      </div>

      {/* Data Date Range Card */}
      <Card className="mb-4">
        <CardContent className="p-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <CalendarIcon className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Data Date Range</p>
                <p className="text-sm text-muted-foreground">
                  {minPODate && maxPODate
                    ? `${format(new Date(minPODate), "MM/dd/yyyy")} - ${format(new Date(maxPODate), "MM/dd/yyyy")}`
                    : "No data loaded"}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Filter:</span>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className={cn(
                      "w-[130px] justify-start text-left font-normal",
                      !dateFrom && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {dateFrom ? format(parseISO(dateFrom), "MM/dd/yyyy") : "From"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={dateFrom ? parseISO(dateFrom) : undefined}
                    onSelect={(date) =>
                      setDateFrom(date ? format(date, "yyyy-MM-dd") : "")
                    }
                  />
                </PopoverContent>
              </Popover>
              <span className="text-muted-foreground">-</span>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className={cn(
                      "w-[130px] justify-start text-left font-normal",
                      !dateTo && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {dateTo ? format(parseISO(dateTo), "MM/dd/yyyy") : "To"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={dateTo ? parseISO(dateTo) : undefined}
                    onSelect={(date) =>
                      setDateTo(date ? format(date, "yyyy-MM-dd") : "")
                    }
                  />
                </PopoverContent>
              </Popover>
              {(dateFrom || dateTo) && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setDateFrom("")
                    setDateTo("")
                  }}
                >
                  Clear
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary stats */}
      <div className="grid gap-4 sm:grid-cols-5">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Spend</p>
                <div className="text-2xl font-bold">
                  {statsLoading ? <Skeleton className="h-8 w-24" /> : formatCurrency(totalSpend)}
                </div>
              </div>
              <FileText className="h-8 w-8 text-muted-foreground/50" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Items</p>
                <div className="text-2xl font-bold">
                  {statsLoading ? <Skeleton className="h-8 w-24" /> : totalItems.toLocaleString()}
                </div>
              </div>
              <FileText className="h-8 w-8 text-muted-foreground/50" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">On Contract</p>
                <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                  {statsLoading ? <Skeleton className="h-8 w-24" /> : onContractCount}
                </div>
              </div>
              <CheckCircle className="h-8 w-8 text-green-500/50" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Off Contract</p>
                <div className="text-2xl font-bold text-red-600 dark:text-red-400">
                  {statsLoading ? <Skeleton className="h-8 w-24" /> : offContractCount}
                </div>
              </div>
              <AlertTriangle className="h-8 w-8 text-red-500/50" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Savings</p>
                <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                  {statsLoading ? <Skeleton className="h-8 w-24" /> : formatCurrency(totalSavings)}
                </div>
              </div>
              <CheckCircle className="h-8 w-8 text-green-500/50" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="cog" className="space-y-4">
        <TabsList>
          <TabsTrigger value="cog">COG Data</TabsTrigger>
          <TabsTrigger value="cogFiles">COG Files</TabsTrigger>
          <TabsTrigger value="pricing">Pricing Files</TabsTrigger>
          <TabsTrigger value="pricingList">Pricing List</TabsTrigger>
        </TabsList>

        <TabsContent value="cog" className="space-y-4">
          <COGRecordsTable facilityId={facilityId} dateFrom={dateFrom || undefined} dateTo={dateTo || undefined} />
        </TabsContent>

        <TabsContent value="cogFiles" className="space-y-4">
          <COGUploadHistory facilityId={facilityId} onImport={() => setCogImportOpen(true)} />
        </TabsContent>

        <TabsContent value="pricing" className="space-y-4">
          <COGUploadHistory facilityId={facilityId} variant="pricing" onImport={() => setPricingImportOpen(true)} />
        </TabsContent>

        <TabsContent value="pricingList" className="space-y-4">
          <PricingFilesTable facilityId={facilityId} />
        </TabsContent>
      </Tabs>

      {/* Import dialogs */}
      <COGImportDialog
        facilityId={facilityId}
        open={cogImportOpen}
        onOpenChange={setCogImportOpen}
        onComplete={() => refetchStats()}
      />

      <PricingImportDialog
        facilityId={facilityId}
        open={pricingImportOpen}
        onOpenChange={setPricingImportOpen}
        onComplete={() => {}}
      />

      <COGManualEntry
        facilityId={facilityId}
        open={manualEntryOpen}
        onOpenChange={setManualEntryOpen}
        onComplete={() => refetchStats()}
      />

      <MassUpload
        facilityId={facilityId}
        open={massUploadOpen}
        onOpenChange={setMassUploadOpen}
      />

      <AlertDialog open={clearAllOpen} onOpenChange={setClearAllOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear all COG data?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete all {totalItems.toLocaleString()} COG
              records for this facility. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                await clearAllMutation.mutateAsync()
                refetchStats()
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Clear All Data
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
