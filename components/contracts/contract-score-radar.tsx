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
 * alongside the AI-driven overall display.
 */

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { BarChart3 } from "lucide-react"
import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  Tooltip,
} from "recharts"
import type { ContractScoreResult } from "@/lib/contracts/scoring"

interface ContractScoreRadarProps {
  components: ContractScoreResult["components"]
}

interface RadarDatum {
  dim: string
  value: number
}

export function ContractScoreRadar({ components }: ContractScoreRadarProps) {
  const data: RadarDatum[] = [
    { dim: "Commitment", value: components.commitmentScore },
    { dim: "Compliance", value: components.complianceScore },
    { dim: "Rebate Efficiency", value: components.rebateEfficiencyScore },
    { dim: "Timeliness", value: components.timelinessScore },
    { dim: "Variance", value: components.varianceScore },
  ]

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5" />
          Score by Dimension
        </CardTitle>
        <CardDescription>
          Rule-based breakdown from commitment, compliance, rebate
          efficiency, timeliness, and invoice variance.
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
            <Radar
              name="Score"
              dataKey="value"
              stroke="#10b981"
              fill="#10b981"
              fillOpacity={0.3}
            />
          </RadarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}
