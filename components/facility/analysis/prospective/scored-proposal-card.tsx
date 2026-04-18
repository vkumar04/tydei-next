"use client"

/**
 * Scored-proposal display card. Reused by the upload tab, manual-entry tab,
 * and proposals list. Renders:
 *   - Overall score big-number
 *   - Verdict badge
 *   - 5-bar chart (ScoreBars)
 *   - Negotiation points + risks as checklists
 *   - Dynamic rebate tier table
 */

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { CheckCircle2, AlertTriangle, Layers } from "lucide-react"
import type { ScoredProposal } from "./types"
import { ScoreBars } from "./score-bars"

interface ScoredProposalCardProps {
  proposal: ScoredProposal
}

const VERDICT_META: Record<
  "accept" | "negotiate" | "decline",
  { label: string; className: string }
> = {
  accept: {
    label: "Accept",
    className:
      "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200 border-emerald-300",
  },
  negotiate: {
    label: "Negotiate",
    className:
      "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200 border-amber-300",
  },
  decline: {
    label: "Decline",
    className:
      "bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-200 border-red-300",
  },
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value)
}

export function ScoredProposalCard({ proposal }: ScoredProposalCardProps) {
  const { result, vendorName } = proposal
  const verdict = VERDICT_META[result.recommendation.verdict]
  const overall = result.scores.overall

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle>{vendorName || "Unnamed vendor"}</CardTitle>
              <CardDescription>
                Scored {new Date(proposal.createdAt).toLocaleString()} ·
                {" "}
                {proposal.source === "upload" ? "from PDF" : "from manual entry"}
              </CardDescription>
            </div>
            <Badge variant="outline" className={verdict.className}>
              {verdict.label}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center gap-6">
            <div>
              <p className="text-sm text-muted-foreground">Overall score</p>
              <p className="text-5xl font-bold tracking-tight">
                {overall.toFixed(1)}
                <span className="text-xl text-muted-foreground font-normal">
                  {" "}
                  / 10
                </span>
              </p>
            </div>
            <div className="flex-1">
              <ScoreBars scores={result.scores} />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              Negotiation points
            </CardTitle>
          </CardHeader>
          <CardContent>
            {result.recommendation.negotiationPoints.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No negotiation points — proposal looks clean.
              </p>
            ) : (
              <ul className="space-y-2">
                {result.recommendation.negotiationPoints.map((p, i) => (
                  <li key={i} className="flex gap-2 text-sm">
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 mt-0.5" />
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              Risks
            </CardTitle>
          </CardHeader>
          <CardContent>
            {result.recommendation.risks.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No significant commitment risks detected.
              </p>
            ) : (
              <ul className="space-y-2">
                {result.recommendation.risks.map((r, i) => (
                  <li key={i} className="flex gap-2 text-sm">
                    <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Layers className="h-4 w-4" />
            Dynamic rebate tiers
          </CardTitle>
          <CardDescription>
            Synthesized from baseline spend + proposed top-tier rate.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="py-2 font-medium">Tier</th>
                  <th className="py-2 font-medium">Minimum spend</th>
                  <th className="py-2 font-medium">Rebate rate</th>
                </tr>
              </thead>
              <tbody>
                {result.dynamicTiers.map((t) => (
                  <tr key={t.name} className="border-b last:border-0">
                    <td className="py-2 font-medium">{t.name}</td>
                    <td className="py-2">{formatCurrency(t.minimumSpend)}</td>
                    <td className="py-2">{t.rate.toFixed(2)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
