import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { ChevronDown } from "lucide-react"
import { formatCurrency, formatPercent } from "@/lib/formatting"
import type { CategoryRow } from "./types"

export function CategoryBreakdownSection({ categoryRows }: { categoryRows: CategoryRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Category Breakdown</CardTitle>
        <CardDescription>
          Expand each category to see vendor spend vs total market detail
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {categoryRows.length === 0 ? (
          <p className="text-center py-8 text-muted-foreground">No category data</p>
        ) : (
          categoryRows.map((row) => (
            <Collapsible key={row.category}>
              <CollapsibleTrigger className="flex w-full items-center justify-between rounded-lg border px-4 py-3 text-left hover:bg-muted/50 transition-colors group">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <span className="font-medium truncate">{row.category}</span>
                  <Badge
                    variant={
                      row.sharePct >= 40 ? "default" : row.sharePct >= 20 ? "secondary" : "outline"
                    }
                  >
                    {formatPercent(row.sharePct)}
                  </Badge>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <div className="w-32 hidden sm:block">
                    <Progress value={Math.min(row.sharePct, 100)} />
                  </div>
                  <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
                </div>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="ml-4 mt-2 mb-3 grid grid-cols-2 gap-4 rounded-lg border bg-muted/30 p-4 text-sm">
                  <div>
                    <p className="text-muted-foreground text-xs">Vendor Spend</p>
                    <p className="text-lg font-semibold">{formatCurrency(row.yourSpend)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">Total Market</p>
                    <p className="text-lg font-semibold">{formatCurrency(row.totalMarket)}</p>
                  </div>
                  <div className="col-span-2">
                    <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                      <span>Share</span>
                      <span>{formatPercent(row.sharePct)}</span>
                    </div>
                    <Progress value={Math.min(row.sharePct, 100)} className="h-3" />
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>
          ))
        )}
      </CardContent>
    </Card>
  )
}
