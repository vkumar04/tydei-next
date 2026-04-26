"use client"

import { useQuery } from "@tanstack/react-query"
import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  Tooltip,
} from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { queryKeys } from "@/lib/query-keys"
import { getContractCompositeScore } from "@/lib/actions/analytics/contract-score"

const AXIS_LABELS: Record<string, string> = {
  rebateEfficiency: "Rebate Efficiency",
  tierProgress: "Tier Progress",
  marketShare: "Market Share",
  pricePerformance: "Price Performance",
  compliance: "Compliance",
  timeValue: "Time Value",
}

/**
 * Grade → semantic color. Tailwind classes win over HSL theme tokens
 * here because the radar chart in dark mode was rendering as a flat
 * near-black tinted with --primary, which read as "no color." A
 * grade-driven palette also makes the card scannable at a glance:
 * green = healthy, red = at-risk.
 */
const GRADE_PALETTE: Record<
  "A" | "B" | "C" | "D" | "F",
  { hex: string; tw: string; badgeTw: string }
> = {
  A: {
    hex: "#10b981", // emerald-500
    tw: "text-emerald-500",
    badgeTw: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  },
  B: {
    hex: "#22c55e", // green-500
    tw: "text-green-500",
    badgeTw: "bg-green-500/15 text-green-600 dark:text-green-400",
  },
  C: {
    hex: "#eab308", // yellow-500
    tw: "text-yellow-500",
    badgeTw: "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400",
  },
  D: {
    hex: "#f97316", // orange-500
    tw: "text-orange-500",
    badgeTw: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
  },
  F: {
    hex: "#ef4444", // red-500
    tw: "text-red-500",
    badgeTw: "bg-red-500/15 text-red-600 dark:text-red-400",
  },
}

function gradeBadge(grade: "A" | "B" | "C" | "D" | "F") {
  return (
    <Badge className={`${GRADE_PALETTE[grade].badgeTw} border-0`}>
      Grade {grade}
    </Badge>
  )
}

export function ContractScoreCard({
  contractId,
  initialScore,
}: {
  contractId: string
  initialScore?: Awaited<ReturnType<typeof getContractCompositeScore>>
}) {
  const { data: score, isLoading: scoreLoading } = useQuery({
    queryKey: queryKeys.analytics.contractScore(contractId),
    queryFn: () => getContractCompositeScore(contractId),
    initialData: initialScore,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
  })

  const radarData = score
    ? Object.entries(score.axes).map(([k, v]) => ({
        axis: AXIS_LABELS[k] ?? k,
        value: v,
      }))
    : []

  return (
    <div>
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
                <span
                  className={`text-5xl font-bold ${GRADE_PALETTE[score.grade].tw}`}
                >
                  {score.composite}
                </span>
                <span className="text-sm text-muted-foreground">/ 100</span>
              </div>
              {/* Recharts strokes/fills don't resolve CSS variables, so
                  the polar grid + axis text need literal colors. Picked
                  slate-500/400 — readable on both light and dark cards
                  without needing a theme listener. */}
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart data={radarData}>
                    <PolarGrid stroke="#64748b" strokeOpacity={0.45} />
                    <PolarAngleAxis
                      dataKey="axis"
                      tick={{ fontSize: 11, fill: "#94a3b8" }}
                    />
                    <PolarRadiusAxis
                      angle={30}
                      domain={[0, 100]}
                      tick={{ fontSize: 9, fill: "#94a3b8" }}
                      stroke="#64748b"
                      strokeOpacity={0.45}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "#0f172a",
                        border: "1px solid #334155",
                        borderRadius: 8,
                        fontSize: 12,
                        padding: "8px 12px",
                      }}
                      labelStyle={{
                        color: "#e2e8f0",
                        fontWeight: 600,
                        marginBottom: 4,
                      }}
                      itemStyle={{ color: "#e2e8f0" }}
                      cursor={{
                        stroke: GRADE_PALETTE[score.grade].hex,
                        strokeOpacity: 0.5,
                      }}
                      formatter={(value) =>
                        typeof value === "number" ? `${value} / 100` : value
                      }
                    />
                    <Radar
                      name="Score"
                      dataKey="value"
                      stroke={GRADE_PALETTE[score.grade].hex}
                      strokeWidth={2}
                      fill={GRADE_PALETTE[score.grade].hex}
                      fillOpacity={0.45}
                    />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </CardContent>
      </Card>

    </div>
  )
}
