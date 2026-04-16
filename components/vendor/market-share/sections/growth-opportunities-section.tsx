import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Lightbulb, Building2 } from "lucide-react"
import { formatCurrency, formatPercent } from "@/lib/formatting"
import type { CategoryRow, FacilityRow } from "./types"

interface Props {
  categoryRows: CategoryRow[]
  facilityRows: FacilityRow[]
}

export function GrowthOpportunitiesSection({ categoryRows, facilityRows }: Props) {
  const lowShare = categoryRows.filter((r) => r.sharePct < 20)
  const avgShare =
    facilityRows.length > 0
      ? facilityRows.reduce((s, r) => s + r.sharePct, 0) / facilityRows.length
      : 0
  const lowFacilities = facilityRows.filter((r) => r.sharePct < avgShare)

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* Low-Share Categories */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Lightbulb className="h-5 w-5 text-amber-500" />
            Low-Share Categories
          </CardTitle>
          <CardDescription>
            Categories where your market share is below 20% — potential growth areas
          </CardDescription>
        </CardHeader>
        <CardContent>
          {lowShare.length === 0 ? (
            <p className="text-center py-6 text-sm text-muted-foreground">
              No low-share categories found. Great coverage!
            </p>
          ) : (
            <div className="space-y-3">
              {lowShare.map((row) => (
                <div
                  key={row.category}
                  className="flex items-center justify-between rounded-lg border p-3"
                >
                  <div className="min-w-0">
                    <p className="font-medium truncate">{row.category}</p>
                    <p className="text-xs text-muted-foreground">
                      Gap: {formatCurrency(row.totalMarket - row.yourSpend)} addressable
                    </p>
                  </div>
                  <Badge
                    variant="outline"
                    className="text-red-600 dark:text-red-400 border-red-300 dark:border-red-700 shrink-0"
                  >
                    {formatPercent(row.sharePct)}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Facility Opportunities */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Building2 className="h-5 w-5 text-blue-500" />
            Facility Opportunities
          </CardTitle>
          <CardDescription>
            Facilities with below-average vendor share — expand your footprint
          </CardDescription>
        </CardHeader>
        <CardContent>
          {lowFacilities.length === 0 ? (
            <p className="text-center py-6 text-sm text-muted-foreground">
              All facilities are at or above average share.
            </p>
          ) : (
            <div className="space-y-3">
              {lowFacilities.slice(0, 5).map((row) => (
                <div
                  key={row.facility}
                  className="flex items-center justify-between rounded-lg border p-3"
                >
                  <div className="min-w-0">
                    <p className="font-medium truncate">{row.facility}</p>
                    <p className="text-xs text-muted-foreground">
                      Current spend: {formatCurrency(row.yourSpend)}
                    </p>
                  </div>
                  <Badge variant="outline" className="shrink-0">
                    {formatPercent(row.sharePct)}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
