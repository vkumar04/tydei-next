"use client"

/**
 * ContractScoreRadar — radar visualization of the rule-based
 * ContractScoreResult.components dimensions produced by
 * lib/contracts/scoring.ts.
 *
 * The engine returns 5 component scores (0-100 each):
 *   commitmentScore, complianceScore, rebateEfficiencyScore,
 *   timelinessScore, varianceScore
 *
 * This chart surfaces those dimensions on the contract score page
 * alongside the AI-driven overall display. When an industry peer-median
 * `benchmark` is supplied, a second translucent slate series is overlaid
 * so the user can compare their contract to peers at a glance.
 */

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { BarChart3, HelpCircle } from "lucide-react"
import {
  Tooltip as UITooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  Tooltip,
  Legend,
} from "recharts"
import type { ContractScoreResult } from "@/lib/contracts/scoring"
import type { ScoreBenchmark } from "@/lib/contracts/score-benchmarks"

interface ContractScoreRadarProps {
  components: ContractScoreResult["components"]
  benchmark?: ScoreBenchmark
}

interface RadarDatum {
  dim: string
  value: number
  benchmark?: number
}

export function ContractScoreRadar({
  components,
  benchmark,
}: ContractScoreRadarProps) {
  const data: RadarDatum[] = [
    {
      dim: "Commitment",
      value: components.commitmentScore,
      benchmark: benchmark?.commitmentScore,
    },
    {
      dim: "Compliance",
      value: components.complianceScore,
      benchmark: benchmark?.complianceScore,
    },
    {
      dim: "Rebate Efficiency",
      value: components.rebateEfficiencyScore,
      benchmark: benchmark?.rebateEfficiencyScore,
    },
    {
      dim: "Timeliness",
      value: components.timelinessScore,
      benchmark: benchmark?.timelinessScore,
    },
    {
      dim: "Variance",
      value: components.varianceScore,
      benchmark: benchmark?.varianceScore,
    },
    {
      dim: "Price Competitiveness",
      value: components.priceCompetitivenessScore ?? 100,
      benchmark: benchmark?.priceCompetitivenessScore ?? 100,
    },
  ]

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5" />
          Score by Dimension
          {benchmark && (
            <TooltipProvider>
              <UITooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex cursor-help items-center">
                    <HelpCircle
                      className="h-3.5 w-3.5 text-muted-foreground"
                      aria-label="Benchmark source help"
                    />
                  </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-[340px] p-3 text-xs">
                  <p>
                    Benchmark comparisons use category + contract-type peer
                    averages from the Tydei market dataset. Hover any axis
                    for the underlying raw values.
                  </p>
                </TooltipContent>
              </UITooltip>
            </TooltipProvider>
          )}
        </CardTitle>
        <CardDescription>
          Rule-based breakdown from commitment, compliance, rebate
          efficiency, timeliness, and invoice variance.
          {benchmark
            ? " Overlaid against peer-median benchmarks for this contract type."
            : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart data={data}>
            <PolarGrid strokeDasharray="3 3" />
            <PolarAngleAxis dataKey="dim" tick={{ fontSize: 11 }} />
            <PolarRadiusAxis
              angle={30}
              domain={[0, 100]}
              tick={{ fontSize: 10 }}
            />
            <Tooltip />
            <Legend />
            <Radar
              name="Score"
              dataKey="value"
              stroke="var(--chart-1)"
              fill="var(--chart-1)"
              fillOpacity={0.3}
            />
            {benchmark && (
              <Radar
                name="Industry benchmark"
                dataKey="benchmark"
                stroke="var(--muted-foreground)"
                fill="var(--muted-foreground)"
                fillOpacity={0.15}
              />
            )}
          </RadarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}
