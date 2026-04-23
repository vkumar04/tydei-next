"use client"

/**
 * Comparison tab (spec §subsystem-4).
 *
 * Two-proposal side-by-side with grouped bar chart (recharts). Relies on the
 * pure `compareProposals` engine for best/worst-per-dimension + recommended
 * winner + savings delta.
 */

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { Download, Trophy } from "lucide-react"
import {
  compareProposals,
  type ProposalForComparison,
} from "@/lib/prospective-analysis/comparison"
import type { ScoredProposal } from "./types"

interface ComparisonTabProps {
  proposals: ScoredProposal[] // exactly 2 when compareable
  onClear: () => void
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value)
}

function toComparable(p: ScoredProposal): ProposalForComparison {
  const totalProjectedSavings =
    p.input.currentSpend > 0
      ? p.input.currentSpend - p.input.proposedAnnualSpend
      : 0
  return {
    id: p.id,
    vendorName: p.vendorName,
    scores: p.result.scores,
    proposedAnnualSpend: p.input.proposedAnnualSpend,
    proposedRebateRate: p.input.proposedRebateRate,
    termYears: p.input.termYears,
    totalProjectedSavings,
  }
}

const SCORE_KEYS = [
  { key: "costSavings" as const, label: "Cost Savings" },
  { key: "priceCompetitiveness" as const, label: "Price Comp." },
  { key: "rebateAttainability" as const, label: "Rebate" },
  { key: "lockInRisk" as const, label: "Lock-In" },
  { key: "tco" as const, label: "TCO" },
]

function exportCsv(proposals: ProposalForComparison[]): void {
  const headers = [
    "Vendor",
    "Overall",
    "Cost Savings",
    "Price Comp.",
    "Rebate",
    "Lock-In",
    "TCO",
    "Proposed Annual",
    "Rebate Rate",
    "Term (years)",
    "Projected Savings",
  ]
  const rows = proposals.map((p) => [
    p.vendorName,
    p.scores.overall.toFixed(2),
    p.scores.costSavings.toFixed(2),
    p.scores.priceCompetitiveness.toFixed(2),
    p.scores.rebateAttainability.toFixed(2),
    p.scores.lockInRisk.toFixed(2),
    p.scores.tco.toFixed(2),
    p.proposedAnnualSpend.toString(),
    p.proposedRebateRate.toString(),
    p.termYears.toString(),
    p.totalProjectedSavings.toFixed(2),
  ])
  const csv = [headers, ...rows]
    .map((r) =>
      r.map((v) => (v.includes(",") ? `"${v.replace(/"/g, '""')}"` : v)).join(","),
    )
    .join("\n")
  const blob = new Blob([csv], { type: "text/csv" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `proposal-comparison-${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export function ComparisonTab({ proposals, onClear }: ComparisonTabProps) {
  if (proposals.length !== 2) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Select 2 proposals to compare</CardTitle>
          <CardDescription>
            Head to the Proposals tab and check two entries, then click
            &ldquo;Compare selected&rdquo;.
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  const comparable = proposals.map(toComparable)
  const result = compareProposals(comparable)
  const recommended = comparable.find(
    (p) => p.id === result.recommendedProposalId,
  )

  const chartData = SCORE_KEYS.map(({ key, label }) => ({
    dimension: label,
    [comparable[0]!.vendorName]: Number(
      comparable[0]!.scores[key].toFixed(2),
    ),
    [comparable[1]!.vendorName]: Number(
      comparable[1]!.scores[key].toFixed(2),
    ),
  }))

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Trophy className="h-5 w-5 text-amber-500" />
                Recommended: {recommended?.vendorName ?? "—"}
              </CardTitle>
              <CardDescription>
                {result.savingsDeltaVsRunnerUp !== null
                  ? `Savings advantage vs runner-up: ${formatCurrency(result.savingsDeltaVsRunnerUp)}`
                  : "Only one proposal — no runner-up."}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => exportCsv(comparable)}
              >
                <Download className="h-4 w-4 mr-1.5" />
                Export CSV
              </Button>
              <Button variant="ghost" size="sm" onClick={onClear}>
                Clear
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="dimension" />
                <YAxis domain={[0, 10]} />
                <Tooltip />
                <Legend />
                <Bar
                  dataKey={comparable[0]!.vendorName}
                  fill="var(--chart-2)"
                  radius={[4, 4, 0, 0]}
                />
                <Bar
                  dataKey={comparable[1]!.vendorName}
                  fill="var(--chart-5)"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {comparable.map((p) => {
          const isWinner = p.id === result.recommendedProposalId
          return (
            <Card key={p.id} className={isWinner ? "border-emerald-400" : ""}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">{p.vendorName}</CardTitle>
                  {isWinner ? (
                    <Badge
                      variant="outline"
                      className="bg-emerald-100 text-emerald-800 border-emerald-300"
                    >
                      Winner
                    </Badge>
                  ) : null}
                </div>
                <CardDescription>
                  Overall {p.scores.overall.toFixed(1)} / 10 · term{" "}
                  {p.termYears}y · rebate {p.proposedRebateRate}%
                </CardDescription>
              </CardHeader>
              <CardContent>
                <table className="w-full text-sm">
                  <tbody>
                    {SCORE_KEYS.map(({ key, label }) => (
                      <tr key={key} className="border-b last:border-0">
                        <td className="py-1.5 text-muted-foreground">
                          {label}
                        </td>
                        <td className="py-1.5 text-right tabular-nums font-medium">
                          {p.scores[key].toFixed(1)}
                          {result.bestOnDimension[key] === p.id ? (
                            <span className="ml-1 text-emerald-600">★</span>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                    <tr>
                      <td className="py-1.5 text-muted-foreground">
                        Proj. savings
                      </td>
                      <td className="py-1.5 text-right tabular-nums font-medium">
                        {formatCurrency(p.totalProjectedSavings)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
