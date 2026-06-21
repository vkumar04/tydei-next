import { Card, CardContent } from "@/components/ui/card"

interface StatCardProps {
  label: string
  value: string
  /**
   * Optional Tailwind text-color class for the value (e.g.
   * "text-emerald-600 dark:text-emerald-400"). Mirrors the `accent` prop the
   * report-hub Stat copies already pass.
   */
  accent?: string
  /**
   * Visual treatment. Each variant reproduces the EXACT markup the migrated
   * copies used, so swapping them in is visually a no-op:
   * - `card`  → shadcn <Card> with a 2xl bold value (reports overview tab).
   * - `muted` → bordered, muted-background tile with an lg bold value
   *             (reports calculations tab).
   */
  variant?: "card" | "muted"
}

/**
 * One shared label+value stat tile for the report hubs (facility + vendor),
 * replacing the byte-identical `StatCard`/`Stat` copies that were forked
 * across `components/{facility,vendor}/reports/...`. Keep new report stat
 * tiles on this component so the two hubs cannot drift.
 */
export function StatCard({
  label,
  value,
  accent,
  variant = "card",
}: StatCardProps) {
  if (variant === "muted") {
    return (
      <div className="rounded-lg border bg-muted/50 p-3">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={`text-lg font-bold ${accent ?? ""}`}>{value}</p>
      </div>
    )
  }
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className={`text-2xl font-bold ${accent ?? ""}`}>{value}</p>
      </CardContent>
    </Card>
  )
}
