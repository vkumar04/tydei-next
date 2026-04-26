"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  User,
  CreditCard,
  DollarSign,
  Scale,
} from "lucide-react"
import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  ResponsiveContainer,
} from "recharts"
import type { SurgeonScorecard } from "@/lib/actions/cases"
import {
  v0PeerVariancePct,
  v0CMIAdjustedSpend,
  v0SurgeonScore,
} from "@/lib/v0-spec/case-costing"

/* ── ScoreIndicator ───────────────────────────────────────────── */

export function ScoreIndicator({
  score,
  label,
}: {
  score: number
  label?: string
}) {
  if (score < 0) {
    return (
      <div className="flex flex-col items-center">
        <div className="text-sm font-medium rounded-full w-10 h-10 flex items-center justify-center text-muted-foreground bg-muted">
          N/A
        </div>
        {label && (
          <span className="text-xs text-muted-foreground mt-1">{label}</span>
        )}
      </div>
    )
  }

  const color =
    score >= 85
      ? "text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20"
      : score >= 70
        ? "text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20"
        : "text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20"

  return (
    <div className="flex flex-col items-center">
      <div
        className={`text-lg font-bold rounded-full w-10 h-10 flex items-center justify-center ${color}`}
      >
        {score}
      </div>
      {label && (
        <span className="text-xs text-muted-foreground mt-1">{label}</span>
      )}
    </div>
  )
}

/* ── Surgeon Detail Dialog ────────────────────────────────────── */

interface SurgeonDetailDialogProps {
  surgeon: SurgeonScorecard | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Optional peer set used by v0PeerVariancePct + v0CMIAdjustedSpend. */
  peers?: SurgeonScorecard[]
}

export function SurgeonDetailDialog({
  surgeon,
  open,
  onOpenChange,
  peers,
}: SurgeonDetailDialogProps) {
  if (!surgeon) return null

  // v0 doc §8 peer-variance + CMI proxy. CMI isn't carried per-case in
  // tydei's schema, so we approximate via the surgeon's case-mix
  // weighted by margin (richer-margin cases ≈ higher CMI). When the
  // proxy can't run (single surgeon, no peers), the display falls
  // back to the raw avg.
  const peerSurgeons = (peers ?? []).filter(
    (p) => p.surgeonName !== surgeon.surgeonName,
  )
  const peerAvg =
    peerSurgeons.length > 0
      ? peerSurgeons.reduce((s, p) => s + p.avgSpendPerCase, 0) /
        peerSurgeons.length
      : 0
  const peerVariancePct = peerAvg > 0
    ? v0PeerVariancePct(surgeon.avgSpendPerCase, peerAvg)
    : 0
  const cmiProxy =
    surgeon.totalReimbursement > 0
      ? Math.max(0.5, surgeon.marginPercent / 100 + 1)
      : 1
  const cmiAdjustedAvg = v0CMIAdjustedSpend(surgeon.avgSpendPerCase, cmiProxy)

  // v0 doc §8 5-axis surgeon score. Renders only when the surgeon has
  // every demographic input filled in; otherwise we fall back to the
  // legacy 3-axis radar (supply-util / compliance / margin) so the
  // dialog still has something to show for surgeons whose Cases lack
  // payor/BMI/age. Score itself is computed locally from the props
  // already on SurgeonScorecard — no extra round-trip.
  const hasV0Inputs =
    surgeon.payorMixPct != null &&
    surgeon.bmiUnder40Pct != null &&
    surgeon.ageUnder65Pct != null &&
    surgeon.avgCaseTimeMinutes != null
  const v0Score = hasV0Inputs
    ? v0SurgeonScore({
        payorMixPct: surgeon.payorMixPct ?? 0,
        bmiUnder40Pct: surgeon.bmiUnder40Pct ?? 0,
        ageUnder65Pct: surgeon.ageUnder65Pct ?? 0,
        avgSpend: surgeon.avgSpendPerCase,
        avgCaseTimeMinutes: surgeon.avgCaseTimeMinutes ?? 0,
      })
    : null

  const radarData = v0Score
    ? [
        { metric: "Payor Mix", value: Math.round(v0Score.payor), fullMark: 100 },
        { metric: "BMI < 40", value: Math.round(v0Score.bmi), fullMark: 100 },
        { metric: "Age < 65", value: Math.round(v0Score.age), fullMark: 100 },
        { metric: "Spend", value: Math.round(v0Score.spend), fullMark: 100 },
        { metric: "OR Time", value: Math.round(v0Score.time), fullMark: 100 },
      ]
    : [
        {
          metric: "Supply Util",
          value: Math.round(surgeon.onContractPercent),
          fullMark: 100,
        },
        {
          metric: "Compliance",
          value: Math.round(surgeon.complianceRate),
          fullMark: 100,
        },
        {
          metric: "Margin",
          value: Math.min(100, Math.max(0, surgeon.marginPercent)),
          fullMark: 100,
        },
      ]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            {surgeon.surgeonName}
          </DialogTitle>
          <DialogDescription>
            {surgeon.caseCount} total cases
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="overview" className="mt-4">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="scores">Scorecard</TabsTrigger>
            <TabsTrigger value="margin">Margin Analysis</TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-4">
            <div className="grid grid-cols-4 gap-4">
              <Card>
                <CardContent className="pt-4">
                  <div className="text-sm text-muted-foreground">
                    Total Cases
                  </div>
                  <div className="text-2xl font-bold">{surgeon.caseCount}</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4">
                  <div className="text-sm text-muted-foreground">
                    Avg Spend/Case
                  </div>
                  <div className="text-2xl font-bold">
                    ${Math.round(surgeon.avgSpendPerCase).toLocaleString()}
                  </div>
                  {peerSurgeons.length > 0 ? (
                    <div className="mt-1 flex items-center gap-2">
                      <Badge
                        variant="secondary"
                        className={
                          Math.abs(peerVariancePct) < 5
                            ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-0"
                            : peerVariancePct > 0
                              ? "bg-red-500/15 text-red-600 dark:text-red-400 border-0"
                              : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-0"
                        }
                      >
                        {peerVariancePct > 0 ? "+" : ""}
                        {peerVariancePct.toFixed(1)}% vs peers
                      </Badge>
                    </div>
                  ) : null}
                  <div className="mt-1 text-xs text-muted-foreground">
                    CMI-adj: ${Math.round(cmiAdjustedAvg).toLocaleString()}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4">
                  <div className="text-sm text-muted-foreground">
                    Compliance
                  </div>
                  <div className="text-2xl font-bold">
                    {Math.round(surgeon.complianceRate)}%
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4">
                  <div className="text-sm text-muted-foreground">
                    Gross Margin
                  </div>
                  <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                    ${Math.round(surgeon.totalMargin).toLocaleString()}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {surgeon.marginPercent}%
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">
                    {v0Score
                      ? "Surgeon Score (v0 §8 — 5 axes)"
                      : "Performance Radar"}
                  </CardTitle>
                  {v0Score ? (
                    <Badge
                      className={
                        v0Score.overall >= 80
                          ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-0"
                          : v0Score.overall >= 60
                            ? "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 border-0"
                            : "bg-red-500/15 text-red-600 dark:text-red-400 border-0"
                      }
                    >
                      Overall {Math.round(v0Score.overall)}
                    </Badge>
                  ) : null}
                </div>
              </CardHeader>
              <CardContent>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <RadarChart data={radarData}>
                      <PolarGrid stroke="#64748b" strokeOpacity={0.45} />
                      <PolarAngleAxis
                        dataKey="metric"
                        tick={{ fontSize: 12, fill: "#94a3b8" }}
                      />
                      <PolarRadiusAxis
                        angle={30}
                        domain={[0, 100]}
                        tick={{ fontSize: 9, fill: "#94a3b8" }}
                        stroke="#64748b"
                        strokeOpacity={0.45}
                      />
                      <Radar
                        name="Score"
                        dataKey="value"
                        stroke="#3b82f6"
                        strokeWidth={2}
                        fill="#3b82f6"
                        fillOpacity={0.4}
                      />
                    </RadarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Scorecard Tab */}
          <TabsContent value="scores" className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <Card>
                <CardContent className="pt-4 text-center">
                  <CreditCard className="h-6 w-6 mx-auto mb-2 text-blue-500" />
                  <div className="text-sm text-muted-foreground mb-1">
                    Supply Utilization
                  </div>
                  <div className="text-3xl font-bold">
                    {Math.round(surgeon.onContractPercent)}%
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    % On Contract
                  </div>
                  <Progress
                    value={surgeon.onContractPercent}
                    className="mt-2"
                  />
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 text-center">
                  <Scale className="h-6 w-6 mx-auto mb-2 text-green-500" />
                  <div className="text-sm text-muted-foreground mb-1">
                    Compliance
                  </div>
                  <div className="text-3xl font-bold">
                    {Math.round(surgeon.complianceRate)}%
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    % Compliant Cases
                  </div>
                  <Progress value={surgeon.complianceRate} className="mt-2" />
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 text-center">
                  <DollarSign className="h-6 w-6 mx-auto mb-2 text-amber-500" />
                  <div className="text-sm text-muted-foreground mb-1">
                    Margin Rate
                  </div>
                  <div className="text-3xl font-bold">
                    {surgeon.marginPercent}%
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    Margin / Reimbursement
                  </div>
                  <Progress
                    value={Math.max(0, Math.min(100, surgeon.marginPercent))}
                    className="mt-2"
                  />
                </CardContent>
              </Card>
            </div>

            {surgeon.topProcedures.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Top Procedures</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-2">
                    {surgeon.topProcedures.map((p) => (
                      <Badge key={p.cptCode} variant="outline">
                        {p.cptCode} ({p.count} cases)
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Margin Analysis Tab */}
          <TabsContent value="margin" className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <Card>
                <CardContent className="pt-4">
                  <div className="text-sm text-muted-foreground">
                    Total Reimbursement
                  </div>
                  <div className="text-2xl font-bold text-blue-600">
                    ${Math.round(surgeon.totalReimbursement).toLocaleString()}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4">
                  <div className="text-sm text-muted-foreground">
                    Total Spend
                  </div>
                  <div className="text-2xl font-bold text-red-600 dark:text-red-400">
                    ${Math.round(surgeon.totalSpend).toLocaleString()}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4">
                  <div className="text-sm text-muted-foreground">
                    Net Margin
                  </div>
                  <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                    ${Math.round(surgeon.totalMargin).toLocaleString()}
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Margin Calculation</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="bg-muted/50 rounded-lg p-6 text-center">
                  <div className="flex items-center justify-center gap-4 text-lg flex-wrap">
                    <span className="text-blue-600 font-semibold">
                      ${Math.round(surgeon.totalReimbursement).toLocaleString()}
                    </span>
                    <span className="text-muted-foreground">reimbursement</span>
                    <span>-</span>
                    <span className="text-red-600 dark:text-red-400 font-semibold">
                      ${Math.round(surgeon.totalSpend).toLocaleString()}
                    </span>
                    <span className="text-muted-foreground">spend</span>
                    <span>=</span>
                    <span className="text-2xl font-bold text-primary">
                      ${Math.round(surgeon.totalMargin).toLocaleString()}
                    </span>
                  </div>
                  <div className="text-sm text-muted-foreground mt-2">
                    {surgeon.marginPercent}% margin rate
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
