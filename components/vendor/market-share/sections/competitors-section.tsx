import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Swords } from "lucide-react"
import { formatCurrency } from "@/lib/formatting"
import type { CategoryRow } from "./types"

interface Props {
  categoryRows: CategoryRow[]
}

/**
 * Competitors view: ranks categories by the size of the competitor book
 * (totalMarket - yourSpend). Helps vendors see where the biggest rival
 * wallet share lives, independent of raw share percentage.
 */
export function CompetitorsSection({ categoryRows }: Props) {
  const ranked = categoryRows
    .map((r) => ({
      ...r,
      competitorSpend: r.totalMarket - r.yourSpend,
      competitorSharePct: 100 - r.sharePct,
    }))
    .filter((r) => r.totalMarket > 0)
    .sort((a, b) => b.competitorSpend - a.competitorSpend)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Swords className="h-5 w-5 text-muted-foreground" />
          Competitor Gap by Category
        </CardTitle>
        <CardDescription>
          Categories ranked by competitor spend — where rival vendors capture
          the most dollars relative to your position.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {ranked.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No category-level competitor signal yet.
          </p>
        ) : (
          <div className="space-y-4">
            {ranked.slice(0, 10).map((row) => (
              <div key={row.category} className="space-y-1.5">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="truncate text-sm font-medium" title={row.category}>
                    {row.category}
                  </p>
                  <p className="text-sm tabular-nums text-muted-foreground">
                    {formatCurrency(row.competitorSpend)}{" "}
                    <span className="text-xs">
                      ({row.competitorSharePct.toFixed(1)}%)
                    </span>
                  </p>
                </div>
                <Progress value={row.competitorSharePct} className="h-2" />
                <p className="text-xs text-muted-foreground">
                  You: {formatCurrency(row.yourSpend)} ({row.sharePct.toFixed(1)}%) ·
                  Market: {formatCurrency(row.totalMarket)}
                </p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
