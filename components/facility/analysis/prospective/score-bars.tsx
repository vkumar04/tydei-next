"use client"

/**
 * Reusable 5-dimension score bar chart. Uses recharts.
 *
 * Takes a ProposalScores object (0-10 per dimension + overall) and renders
 * the 5 scoring dimensions as horizontal bars, color-coded by score band.
 */

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import type { ProposalScores } from "@/lib/prospective-analysis/scoring"

const DIMENSIONS: ReadonlyArray<{
  key: keyof Omit<ProposalScores, "overall">
  label: string
}> = [
  { key: "costSavings", label: "Cost Savings" },
  { key: "priceCompetitiveness", label: "Price Competitive" },
  { key: "rebateAttainability", label: "Rebate Attain." },
  { key: "lockInRisk", label: "Lock-In Safety" },
  { key: "tco", label: "TCO" },
]

function barColor(score: number): string {
  if (score >= 7.5) return "#10b981" // emerald-500
  if (score >= 5) return "#f59e0b" // amber-500
  return "#ef4444" // red-500
}

export interface ScoreBarsProps {
  scores: ProposalScores
  height?: number
}

export function ScoreBars({ scores, height = 240 }: ScoreBarsProps) {
  const data = DIMENSIONS.map((d) => ({
    dimension: d.label,
    score: Number(scores[d.key].toFixed(2)),
  }))

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ left: 20, right: 20, top: 10, bottom: 10 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis
          type="number"
          domain={[0, 10]}
          tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
        />
        <YAxis
          type="category"
          dataKey="dimension"
          width={120}
          tick={{ fill: "hsl(var(--foreground))", fontSize: 12 }}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: "hsl(var(--background))",
            border: "1px solid hsl(var(--border))",
            borderRadius: 6,
          }}
          formatter={(value) => {
            const n = typeof value === "number" ? value : Number(value)
            return [`${n.toFixed(2)} / 10`, "Score"]
          }}
        />
        <Bar dataKey="score" radius={[0, 4, 4, 0]}>
          {data.map((entry, idx) => (
            <Cell key={`cell-${idx}`} fill={barColor(entry.score)} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
