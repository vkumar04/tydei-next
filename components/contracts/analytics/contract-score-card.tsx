"use client"

import { useQuery } from "@tanstack/react-query"
import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
} from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import { queryKeys } from "@/lib/query-keys"
import { getContractCompositeScore } from "@/lib/actions/analytics/contract-score"
import { getRenewalRisk } from "@/lib/actions/analytics/renewal-risk"

const AXIS_LABELS: Record<string, string> = {
  rebateEfficiency: "Rebate Efficiency",
  tierProgress: "Tier Progress",
  marketShare: "Market Share",
  pricePerformance: "Price Performance",
  compliance: "Compliance",
  timeValue: "Time Value",
}

function gradeBadge(grade: "A" | "B" | "C" | "D" | "F") {
  const variant =
    grade === "A" || grade === "B"
      ? "default"
      : grade === "C"
        ? "secondary"
        : "destructive"
  return <Badge variant={variant}>{grade}</Badge>
}

function riskBadge(level: "low" | "medium" | "high") {
  if (level === "low") return <Badge variant="default">Low</Badge>
  if (level === "medium") return <Badge variant="secondary">Medium</Badge>
  return <Badge variant="destructive">High</Badge>
}

export function ContractScoreCard({ contractId }: { contractId: string }) {
  const { data: score, isLoading: scoreLoading } = useQuery({
    queryKey: queryKeys.analytics.contractScore(contractId),
    queryFn: () => getContractCompositeScore(contractId),
  })
  const { data: risk, isLoading: riskLoading } = useQuery({
    queryKey: queryKeys.analytics.renewalRisk(contractId),
    queryFn: () => getRenewalRisk(contractId),
  })

  const radarData = score
    ? Object.entries(score.axes).map(([k, v]) => ({
        axis: AXIS_LABELS[k] ?? k,
        value: v,
      }))
    : []

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Contract Composite Score</CardTitle>
            {score ? gradeBadge(score.grade) : null}
          </div>
        </CardHeader>
        <CardContent>
          {scoreLoading || !score ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <>
              <div className="mb-4 flex items-baseline gap-2">
                <span className="text-4xl font-bold">{score.composite}</span>
                <span className="text-sm text-muted-foreground">/ 100</span>
              </div>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart data={radarData}>
                    <PolarGrid />
                    <PolarAngleAxis dataKey="axis" tick={{ fontSize: 11 }} />
                    <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} />
                    <Radar
                      name="Score"
                      dataKey="value"
                      stroke="hsl(var(--primary))"
                      fill="hsl(var(--primary))"
                      fillOpacity={0.4}
                    />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Renewal Risk</CardTitle>
            {risk ? riskBadge(risk.riskLevel) : null}
          </div>
        </CardHeader>
        <CardContent>
          {riskLoading || !risk ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <div className="space-y-4">
              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-bold">{risk.riskScore}</span>
                <span className="text-sm text-muted-foreground">/ 100</span>
              </div>
              <Progress value={risk.riskScore} />
              <p className="text-xs text-muted-foreground">
                Composite of days-to-expiration, compliance, price variance,
                vendor responsiveness, rebate utilization, and open issues.
                Higher = more renewal risk.
              </p>
              {score ? (
                <div className="space-y-2 pt-2">
                  {Object.entries(score.axes).map(([k, v]) => (
                    <div key={k}>
                      <div className="mb-1 flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">
                          {AXIS_LABELS[k] ?? k}
                        </span>
                        <span className="font-mono">{v}</span>
                      </div>
                      <Progress value={v} className="h-1.5" />
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
