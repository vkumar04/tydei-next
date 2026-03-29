"use client"

import { useState } from "react"
import { PageHeader } from "@/components/shared/page-header"
import { ProposalUpload } from "./proposal-upload"
import { ProposalComparisonTable } from "./proposal-comparison-table"
import { DealScoreRadar } from "./deal-score-radar"
import type { ProposalAnalysis } from "@/lib/actions/prospective"

interface ProspectiveClientProps {
  facilityId: string
}

export function ProspectiveClient({ facilityId }: ProspectiveClientProps) {
  const [analysis, setAnalysis] = useState<ProposalAnalysis | null>(null)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Prospective Analysis"
        description="Upload vendor proposals and compare pricing against current COG data"
      />

      <ProposalUpload facilityId={facilityId} onAnalyzed={setAnalysis} />

      {analysis && (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <SummaryCard
              label="Total Current Cost"
              value={`$${analysis.totalCurrentCost.toLocaleString()}`}
            />
            <SummaryCard
              label="Total Proposed Cost"
              value={`$${analysis.totalProposedCost.toLocaleString()}`}
            />
            <SummaryCard
              label="Total Savings"
              value={`$${analysis.totalSavings.toLocaleString()}`}
              className={analysis.totalSavings >= 0 ? "text-emerald-600" : "text-red-600"}
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <DealScoreRadar score={analysis.dealScore} />
            <ProposalComparisonTable comparisons={analysis.itemComparisons} />
          </div>
        </>
      )}
    </div>
  )
}

function SummaryCard({
  label,
  value,
  className,
}: {
  label: string
  value: string
  className?: string
}) {
  return (
    <div className="rounded-lg border p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={`text-2xl font-bold ${className ?? ""}`}>{value}</p>
    </div>
  )
}
