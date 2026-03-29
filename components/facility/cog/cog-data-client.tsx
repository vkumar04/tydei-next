"use client"

import { PageHeader } from "@/components/shared/page-header"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { COGRecordsTable } from "@/components/facility/cog/cog-records-table"
import { PricingFilesTable } from "@/components/facility/cog/pricing-files-table"
import { COGUploadHistory } from "@/components/facility/cog/cog-upload-history"

interface COGDataClientProps {
  facilityId: string
}

export function COGDataClient({ facilityId }: COGDataClientProps) {
  return (
    <div className="space-y-6">
      <PageHeader
        title="COG Data"
        description="Cost of goods records, pricing files, and import history"
      />

      <Tabs defaultValue="records">
        <TabsList>
          <TabsTrigger value="records">COG Records</TabsTrigger>
          <TabsTrigger value="pricing">Pricing Files</TabsTrigger>
          <TabsTrigger value="history">Upload History</TabsTrigger>
        </TabsList>

        <TabsContent value="records" className="mt-4">
          <COGRecordsTable facilityId={facilityId} />
        </TabsContent>

        <TabsContent value="pricing" className="mt-4">
          <PricingFilesTable facilityId={facilityId} />
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          <COGUploadHistory facilityId={facilityId} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
