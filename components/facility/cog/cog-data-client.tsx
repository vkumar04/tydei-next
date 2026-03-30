"use client"

import { useState } from "react"
import {
  FileText,
  Upload,
  CheckCircle,
  AlertTriangle,
  Plus,
} from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { COGRecordsTable } from "@/components/facility/cog/cog-records-table"
import { PricingFilesTable } from "@/components/facility/cog/pricing-files-table"
import { COGUploadHistory } from "@/components/facility/cog/cog-upload-history"
import { COGImportDialog } from "@/components/facility/cog/cog-import-dialog"
import { PricingImportDialog } from "@/components/facility/cog/pricing-import-dialog"
import { COGManualEntry } from "@/components/facility/cog/cog-manual-entry"
import { useCOGStats } from "@/hooks/use-cog"
import { formatCurrency } from "@/lib/formatting"

interface COGDataClientProps {
  facilityId: string
}

export function COGDataClient({ facilityId }: COGDataClientProps) {
  const [cogImportOpen, setCogImportOpen] = useState(false)
  const [pricingImportOpen, setPricingImportOpen] = useState(false)
  const [manualEntryOpen, setManualEntryOpen] = useState(false)

  // Fetch aggregated stats from server (not from paginated records)
  const { data: stats, refetch: refetchStats } = useCOGStats(facilityId)

  const totalSpend = stats?.totalSpend ?? 0
  const totalItems = stats?.totalItems ?? 0
  const onContractCount = stats?.onContractCount ?? 0
  const offContractCount = stats?.offContractCount ?? 0
  const totalSavings = totalSpend * 0.05

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

      {/* Summary stats */}
      <div className="grid gap-4 sm:grid-cols-5">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Spend</p>
                <p className="text-2xl font-bold">
                  {formatCurrency(totalSpend)}
                </p>
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
                <p className="text-2xl font-bold">
                  {totalItems.toLocaleString()}
                </p>
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
                <p className="text-2xl font-bold text-green-600 dark:text-green-400">
                  {onContractCount}
                </p>
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
                <p className="text-2xl font-bold text-red-600 dark:text-red-400">
                  {offContractCount}
                </p>
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
                <p className="text-2xl font-bold text-green-600 dark:text-green-400">
                  {formatCurrency(totalSavings)}
                </p>
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
          <COGRecordsTable facilityId={facilityId} />
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
    </div>
  )
}
