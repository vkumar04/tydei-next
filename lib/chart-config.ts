import type { CSSProperties } from "react"

/** Reusable Recharts tooltip contentStyle — uses CSS variables for theme consistency. */
export const chartTooltipStyle: CSSProperties = {
  backgroundColor: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: "8px",
  color: "var(--popover-foreground)",
}

/** Ordered chart color CSS variables for fills / strokes. */
export const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
] as const

/** Helper to get a chart color by index (wraps around). */
export function chartColor(index: number): string {
  return CHART_COLORS[index % CHART_COLORS.length]!
}
