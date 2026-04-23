"use client"

import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { COGRecordsTable } from "@/components/facility/cog/cog-records-table"
import { PricingFilesTable } from "@/components/facility/cog/pricing-files-table"
import { COGUploadHistory } from "@/components/facility/cog/cog-upload-history"
import { UploadedPricingFilesCard } from "@/components/facility/cog/uploaded-pricing-files-card"
import { COGImportDialog } from "@/components/facility/cog/cog-import-dialog"
import { PricingImportDialog } from "@/components/facility/cog/pricing-import-dialog"
import { COGManualEntry } from "@/components/facility/cog/cog-manual-entry"
import { CogEnrichmentStatsPanel } from "@/components/facility/cog/cog-enrichment-stats-panel"
import { PricingImportHistoryCard } from "@/components/facility/cog/pricing-import-history-card"
import { CogHero } from "@/components/facility/cog/cog-hero"
import { CogControlBar } from "@/components/facility/cog/cog-control-bar"
import { MassUpload } from "@/components/import/mass-upload"
import { toast } from "sonner"
import { useCOGStats, useClearAllCOGRecords } from "@/hooks/use-cog"
import { matchCOGToContracts } from "@/lib/actions/cog-match"
import { backfillCOGEnrichment } from "@/lib/actions/cog-import/backfill"
import { useMutation, useQueryClient } from "@tanstack/react-query"
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
  const { data: stats, isPending: statsLoading, refetch: refetchStats } =
    useCOGStats(facilityId)
  const clearAllMutation = useClearAllCOGRecords()
  const qc = useQueryClient()
  const matchMutation = useMutation({
    mutationFn: matchCOGToContracts,
    onSuccess: (result) => {
      toast.success(
        `Matched ${result.recordsUpdated.toLocaleString()} records to vendors. ` +
          `${result.onContractAfter.toLocaleString()} now on-contract. ` +
          `${result.vendorsUnmatched} vendor(s) unmatched.`,
      )
      refetchStats()
      qc.invalidateQueries({ queryKey: ["cog-records"] })
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Matching failed")
    },
  })
  const backfillMutation = useMutation({
    mutationFn: backfillCOGEnrichment,
    onSuccess: (r) => {
      // Charles R5.30 — show the transition matrix so the user knows
      // where their records landed after the cascade ran.
      const parts: string[] = []
      if (r.onContract) parts.push(`${r.onContract.toLocaleString()} → on_contract`)
      if (r.priceVariance)
        parts.push(`${r.priceVariance.toLocaleString()} → price_variance`)
      if (r.offContract)
        parts.push(`${r.offContract.toLocaleString()} → off_contract_item`)
      if (r.outOfScope)
        parts.push(`${r.outOfScope.toLocaleString()} → out_of_scope`)
      if (r.unknownVendor)
        parts.push(`${r.unknownVendor.toLocaleString()} → unknown_vendor`)
      if (r.pending) parts.push(`${r.pending.toLocaleString()} still pending`)
      const summary = parts.length > 0 ? parts.join(", ") : "no changes"
      toast.success(
        `Enriched ${r.enriched.toLocaleString()} records — ${summary}`,
        { duration: 8000 },
      )
      refetchStats()
      qc.invalidateQueries({ queryKey: ["cog"] })
      qc.invalidateQueries({ queryKey: ["cog-records"] })
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : "Backfill failed")
    },
  })

  const totalSpend = stats?.totalSpend ?? 0
  const totalItems = stats?.totalItems ?? 0
  const onContractCount = stats?.onContractCount ?? 0
  const offContractCount = stats?.offContractCount ?? 0
  const minPODate = stats?.minPODate ?? null
  const maxPODate = stats?.maxPODate ?? null

  return (
    <div className="flex flex-col gap-6">
      <CogHero
        totalSpend={totalSpend}
        totalItems={totalItems}
        onContractCount={onContractCount}
        offContractCount={offContractCount}
        minPODate={minPODate}
        maxPODate={maxPODate}
        isLoading={statsLoading}
      />

      <CogControlBar
        dateFrom={dateFrom}
        onDateFromChange={setDateFrom}
        dateTo={dateTo}
        onDateToChange={setDateTo}
        onMassUpload={() => setMassUploadOpen(true)}
        onMatchPricing={() => {
          toast.info("Matching COG items to contracts...")
          matchMutation.mutate()
        }}
        matchPending={matchMutation.isPending}
        onRerunMatch={() => backfillMutation.mutate()}
        rerunPending={backfillMutation.isPending}
        onImport={() => setCogImportOpen(true)}
        onManualEntry={() => setManualEntryOpen(true)}
        onClearAll={() => setClearAllOpen(true)}
      />

      {/* Enrichment stats panel — rows total / matched / unmatched /
          on-contract%. See COG data rewrite spec §6. */}
      <CogEnrichmentStatsPanel facilityId={facilityId} />

      {/* Pricing-file import history (Subsystem 10.3) */}
      <PricingImportHistoryCard />

      <Tabs defaultValue="cog" className="space-y-4">
        <TabsList>
          <TabsTrigger value="cog">COG Data</TabsTrigger>
          <TabsTrigger value="cogFiles">COG Files</TabsTrigger>
          <TabsTrigger value="pricing">Pricing Files</TabsTrigger>
          <TabsTrigger value="pricingList">Pricing List</TabsTrigger>
        </TabsList>

        <TabsContent value="cog" className="space-y-4">
          <COGRecordsTable
            facilityId={facilityId}
            dateFrom={dateFrom || undefined}
            dateTo={dateTo || undefined}
            onRerunMatch={() => backfillMutation.mutate()}
            isRerunning={backfillMutation.isPending}
            totalRecords={totalItems}
          />
        </TabsContent>

        <TabsContent value="cogFiles" className="space-y-4">
          <COGUploadHistory
            facilityId={facilityId}
            onImport={() => setCogImportOpen(true)}
          />
        </TabsContent>

        <TabsContent value="pricing" className="space-y-4">
          <UploadedPricingFilesCard
            facilityId={facilityId}
            onImport={() => setPricingImportOpen(true)}
          />
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
