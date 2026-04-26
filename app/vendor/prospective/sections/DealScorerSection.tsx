"use client"

import { useMemo, useState } from "react"
import {
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
} from "recharts"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Gauge } from "lucide-react"
import { formatCurrency } from "@/lib/formatting"
import { chartTooltipStyle } from "@/lib/chart-config"
import { RecommendationBadge, scoreColor } from "./shared"
import type { VendorProposal } from "@/lib/actions/prospective"

const RECOMMENDATION_BLURB: Record<string, string> = {
  strong_accept:
    "Excellent metrics across all dimensions. Highly recommended for immediate acceptance.",
  accept: "Favorable terms overall. Consider moving forward with standard review.",
  negotiate: "Some dimensions could be improved. Consider adjusting pricing or terms.",
  reject: "Significant revisions needed before this can be considered competitive.",
}

export function DealScorerSection({ proposals }: { proposals: VendorProposal[] }) {
  const [selectedProposalId, setSelectedProposalId] = useState<string>("")

  const selectedProposal = useMemo(
    () => proposals.find((p) => p.id === selectedProposalId) ?? null,
    [selectedProposalId, proposals],
  )

  // Real `dealScore` is attached server-side by the Deal Scorer pipeline
  // (see `analyzeProposal` / `scoreDeal` in lib/actions/prospective.ts). The
  // current `getVendorProposals` action returns `dealScore: null` for stored
  // proposals because we don't yet persist the score on the proposal row.
  // Until that pipeline runs and writes back, this stays null and we render
  // an explicit empty state instead of a fabricated number.
  const score = selectedProposal?.dealScore ?? null

  const radarData = useMemo(() => {
    if (!score) return []
    return [
      { dimension: "Savings Potential", value: score.financialValue, fullMark: 100 },
      { dimension: "Price Competitiveness", value: score.pricingCompetitiveness, fullMark: 100 },
      { dimension: "Rebate Efficiency", value: score.rebateEfficiency, fullMark: 100 },
      { dimension: "Compliance", value: score.complianceLikelihood, fullMark: 100 },
      { dimension: "Market Share", value: score.marketShareAlignment, fullMark: 100 },
    ]
  }, [score])

  if (proposals.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <Gauge className="mx-auto mb-4 h-12 w-12 text-muted-foreground/50" />
          <p className="font-medium text-muted-foreground">No proposals to score</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Create a proposal first to see its deal score analysis
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Select Proposal</CardTitle>
          <CardDescription>Choose a proposal to analyze its deal score</CardDescription>
        </CardHeader>
        <CardContent>
          <Select value={selectedProposalId} onValueChange={setSelectedProposalId}>
            <SelectTrigger className="w-full max-w-md">
              <SelectValue placeholder="Select a proposal..." />
            </SelectTrigger>
            <SelectContent>
              {proposals.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.itemCount} items - {formatCurrency(p.totalProposedCost)} ({p.facilityIds.length} facilities)
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {selectedProposal && !score && (
        <Card>
          <CardContent className="py-12 text-center">
            <Gauge className="mx-auto mb-4 h-12 w-12 text-muted-foreground/50" />
            <p className="font-medium text-muted-foreground">
              Score not yet computed
            </p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              Deal scoring requires running this proposal through the Deal
              Scorer pipeline (analyze the proposed pricing against the
              facility's COG and contract data). That pipeline is not yet
              enabled in this build, so no fabricated score is shown.
            </p>
          </CardContent>
        </Card>
      )}

      {score && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Deal Score Analysis</CardTitle>
                <div className={`text-2xl font-bold ${scoreColor(score.overall)}`}>
                  {score.overall}/100
                </div>
              </div>
              <CardDescription>Multi-dimensional scoring across 5 key deal factors</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart data={radarData}>
                    <PolarGrid className="stroke-muted" />
                    <PolarAngleAxis dataKey="dimension" tick={{ fontSize: 10 }} className="fill-muted-foreground" />
                    <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fontSize: 10 }} />
                    <Radar
                      name="Score"
                      dataKey="value"
                      stroke="var(--primary)"
                      fill="var(--primary)"
                      fillOpacity={0.2}
                    />
                    <RechartsTooltip contentStyle={chartTooltipStyle} />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Recommendation</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-3">
                  <RecommendationBadge recommendation={score.recommendation} />
                  <span className="text-sm text-muted-foreground">
                    Based on weighted analysis of all dimensions
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">
                  {RECOMMENDATION_BLURB[score.recommendation]}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Dimension Breakdown</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {[
                    { label: "Savings Potential", value: score.financialValue, weight: "30%" },
                    { label: "Price Competitiveness", value: score.pricingCompetitiveness, weight: "25%" },
                    { label: "Rebate Efficiency", value: score.rebateEfficiency, weight: "15%" },
                    { label: "Compliance", value: score.complianceLikelihood, weight: "15%" },
                    { label: "Market Share", value: score.marketShareAlignment, weight: "15%" },
                  ].map((dim) => (
                    <div key={dim.label} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">{dim.label}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">({dim.weight})</span>
                          <span className={`font-medium ${scoreColor(dim.value)}`}>{dim.value}</span>
                        </div>
                      </div>
                      <div className="h-2 rounded-full bg-muted">
                        <div
                          className={`h-full rounded-full transition-all ${
                            dim.value >= 80
                              ? "bg-green-500"
                              : dim.value >= 65
                                ? "bg-emerald-500"
                                : dim.value >= 40
                                  ? "bg-amber-500"
                                  : "bg-red-500"
                          }`}
                          style={{ width: `${dim.value}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  )
}
