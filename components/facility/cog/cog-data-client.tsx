"use client"

import { useState, useMemo } from "react"
import {
  FileText,
  Upload,
  DollarSign,
  Users,
  Calendar,
  ShoppingCart,
} from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { COGRecordsTable } from "@/components/facility/cog/cog-records-table"
import { PricingFilesTable } from "@/components/facility/cog/pricing-files-table"
import { COGUploadHistory } from "@/components/facility/cog/cog-upload-history"
import { COGImportDialog } from "@/components/facility/cog/cog-import-dialog"
import { PricingImportDialog } from "@/components/facility/cog/pricing-import-dialog"
import { useCOGRecords } from "@/hooks/use-cog"
import { formatCurrency, formatDate } from "@/lib/formatting"

interface COGDataClientProps {
  facilityId: string
}

export function COGDataClient({ facilityId }: COGDataClientProps) {
  const [cogImportOpen, setCogImportOpen] = useState(false)
  const [pricingImportOpen, setPricingImportOpen] = useState(false)

  // Fetch data for summary stats
  const { data: cogData, refetch: refetchCOG } = useCOGRecords(facilityId)

  const stats = useMemo(() => {
    const records = cogData?.records ?? []
    const totalRecords = cogData?.total ?? 0
    const totalVendors = new Set(
      records.map((r) => r.vendor?.name ?? r.vendorName).filter(Boolean)
    ).size
    const latestDate =
      records.length > 0
        ? records.reduce((latest, r) => {
            const d = new Date(r.transactionDate)
            return d > latest ? d : latest
          }, new Date(0))
        : null
    const totalSpend = records.reduce(
      (sum, r) => sum + Number(r.extendedPrice ?? 0),
      0
    )
    return { totalRecords, totalVendors, latestDate, totalSpend }
  }, [cogData])

  return (
    <div className="flex flex-col gap-6">
      {/* Page header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">COG Data</h1>
          <p className="text-muted-foreground">
            Manage your Cost of Goods data and vendor pricing files
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setCogImportOpen(true)}>
            <Upload className="mr-2 h-4 w-4" />
            Import COG CSV
          </Button>
          <Button onClick={() => setPricingImportOpen(true)}>
            <FileText className="mr-2 h-4 w-4" />
            Upload Pricing File
          </Button>
        </div>
      </div>

      {/* Summary stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Records</p>
                <p className="text-2xl font-bold">
                  {stats.totalRecords.toLocaleString()}
                </p>
              </div>
              <ShoppingCart className="h-8 w-8 text-muted-foreground/50" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Vendors</p>
                <p className="text-2xl font-bold">
                  {stats.totalVendors.toLocaleString()}
                </p>
              </div>
              <Users className="h-8 w-8 text-muted-foreground/50" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Latest Upload</p>
                <p className="text-2xl font-bold">
                  {stats.latestDate ? formatDate(stats.latestDate) : "--"}
                </p>
              </div>
              <Calendar className="h-8 w-8 text-muted-foreground/50" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Spend</p>
                <p className="text-2xl font-bold">
                  {formatCurrency(stats.totalSpend)}
                </p>
              </div>
              <DollarSign className="h-8 w-8 text-muted-foreground/50" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="cog" className="space-y-4">
        <TabsList>
          <TabsTrigger value="cog">COG Data</TabsTrigger>
          <TabsTrigger value="uploads">Uploaded Files</TabsTrigger>
          <TabsTrigger value="pricing">Pricing List</TabsTrigger>
        </TabsList>

        <TabsContent value="cog" className="mt-4">
          <COGRecordsTable facilityId={facilityId} />
        </TabsContent>

        <TabsContent value="uploads" className="mt-4">
          <COGUploadHistory facilityId={facilityId} />
        </TabsContent>

        <TabsContent value="pricing" className="mt-4">
          <PricingFilesTable facilityId={facilityId} />
        </TabsContent>
      </Tabs>

      {/* Import dialogs */}
      <COGImportDialog
        facilityId={facilityId}
        open={cogImportOpen}
        onOpenChange={setCogImportOpen}
        onComplete={() => refetchCOG()}
      />

      <PricingImportDialog
        facilityId={facilityId}
        open={pricingImportOpen}
        onOpenChange={setPricingImportOpen}
        onComplete={() => {}}
      />
    </div>
  )
}
