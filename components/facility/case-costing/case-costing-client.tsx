"use client"

import { useState } from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Upload } from "lucide-react"
import { PageHeader } from "@/components/shared/page-header"
import { Skeleton } from "@/components/ui/skeleton"
import { CaseTable } from "./case-table"
import { SurgeonScorecardsGrid } from "./surgeon-scorecards-grid"
import { CPTAnalysisTable } from "./cpt-analysis-table"
import { CaseImportDialog } from "./case-import-dialog"
import { useSurgeonScorecards, useCPTAnalysis } from "@/hooks/use-case-costing"

interface CaseCostingClientProps {
  facilityId: string
}

export function CaseCostingClient({ facilityId }: CaseCostingClientProps) {
  const [importOpen, setImportOpen] = useState(false)
  const { data: scorecards, isLoading: scLoading } = useSurgeonScorecards(facilityId)
  const { data: cptData, isLoading: cptLoading } = useCPTAnalysis(facilityId)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Case Costing"
        description="Analyze surgical case costs, surgeon performance, and procedure trends"
        action={
          <Button onClick={() => setImportOpen(true)}>
            <Upload className="size-4" /> Import Cases
          </Button>
        }
      />

      <Tabs defaultValue="cases">
        <TabsList>
          <TabsTrigger value="cases">Cases</TabsTrigger>
          <TabsTrigger value="scorecards">Surgeon Scorecards</TabsTrigger>
          <TabsTrigger value="cpt">CPT Analysis</TabsTrigger>
        </TabsList>

        <TabsContent value="cases" className="mt-4">
          <CaseTable facilityId={facilityId} />
        </TabsContent>

        <TabsContent value="scorecards" className="mt-4">
          {scLoading ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-[220px] rounded-xl" />
              ))}
            </div>
          ) : (
            <SurgeonScorecardsGrid scorecards={scorecards ?? []} />
          )}
        </TabsContent>

        <TabsContent value="cpt" className="mt-4">
          {cptLoading ? (
            <Skeleton className="h-[400px] rounded-md" />
          ) : (
            <CPTAnalysisTable analyses={cptData ?? []} />
          )}
        </TabsContent>
      </Tabs>

      <CaseImportDialog
        facilityId={facilityId}
        open={importOpen}
        onOpenChange={setImportOpen}
        onComplete={() => {}}
      />
    </div>
  )
}
