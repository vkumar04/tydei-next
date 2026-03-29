"use client"

import { useMemo } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Clock, RefreshCw } from "lucide-react"
import type { ExpiringContract } from "@/lib/actions/renewals"

interface RenewalTimelineProps {
  contracts: ExpiringContract[]
  onInitiate: (contractId: string) => void
}

const WINDOWS = [
  { label: "Within 30 Days", max: 30, color: "text-red-500" },
  { label: "30-60 Days", max: 60, color: "text-amber-500" },
  { label: "60-90 Days", max: 90, color: "text-yellow-500" },
  { label: "90-120 Days", max: 120, color: "text-blue-500" },
]

export function RenewalTimeline({ contracts, onInitiate }: RenewalTimelineProps) {
  const grouped = useMemo(() => {
    return WINDOWS.map((w) => ({
      ...w,
      contracts: contracts.filter((c) => {
        const prev = WINDOWS[WINDOWS.indexOf(w) - 1]?.max ?? 0
        return c.daysUntilExpiry > prev && c.daysUntilExpiry <= w.max
      }),
    }))
  }, [contracts])

  return (
    <ScrollArea className="h-[600px]">
      <div className="space-y-6">
        {grouped.map((group) => (
          <div key={group.label}>
            <h3 className={`mb-3 text-sm font-semibold ${group.color}`}>
              {group.label} ({group.contracts.length})
            </h3>
            {group.contracts.length === 0 ? (
              <p className="text-sm text-muted-foreground">No contracts in this window</p>
            ) : (
              <div className="space-y-3">
                {group.contracts.map((c) => (
                  <Card key={c.id}>
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between">
                        <div>
                          <CardTitle className="text-sm font-medium">{c.name}</CardTitle>
                          <p className="text-xs text-muted-foreground">{c.vendorName}</p>
                        </div>
                        <Badge variant={c.daysUntilExpiry <= 30 ? "destructive" : "secondary"}>
                          <Clock className="mr-1 size-3" />
                          {c.daysUntilExpiry}d
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="grid grid-cols-3 gap-2 text-xs">
                        <div>
                          <p className="text-muted-foreground">Spend</p>
                          <p className="font-medium">${c.totalSpend.toLocaleString()}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Rebate</p>
                          <p className="font-medium">${c.totalRebate.toLocaleString()}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Tier</p>
                          <p className="font-medium">{c.tierAchieved ?? "N/A"}</p>
                        </div>
                      </div>
                      <Progress value={100 - (c.daysUntilExpiry / 120) * 100} className="h-1.5" />
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full"
                        onClick={() => onInitiate(c.id)}
                      >
                        <RefreshCw className="mr-1.5 size-3" />
                        Initiate Renewal
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </ScrollArea>
  )
}
