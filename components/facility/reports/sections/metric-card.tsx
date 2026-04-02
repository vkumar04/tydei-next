"use client"

/* ─── Metric Card ────────────────────────────────────────────── */

export interface MetricCardProps {
  label: string
  value: string
  className?: string
}

export function MetricCard({ label, value, className }: MetricCardProps) {
  return (
    <div className="p-4 rounded-lg border bg-muted/50">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={`text-xl font-bold ${className ?? ""}`}>{value}</p>
    </div>
  )
}
