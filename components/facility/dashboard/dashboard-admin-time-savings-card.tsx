"use client"

import { useQuery } from "@tanstack/react-query"
import { Clock } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { getAdminTimeSavings } from "@/lib/actions/analytics/admin-time-savings"

export function DashboardAdminTimeSavingsCard() {
  const { data, isLoading } = useQuery({
    queryKey: ["analytics", "adminTimeSavings"],
    queryFn: () => getAdminTimeSavings(),
  })

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Clock className="h-4 w-4 text-primary" />
            Admin Time Savings (per month)
          </CardTitle>
          {data ? (
            <Badge variant="default">
              {data.savingsPercent.toFixed(0)}% saved
            </Badge>
          ) : null}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading || !data ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <p className="text-xs text-muted-foreground">Manual hours</p>
                <p className="text-2xl font-semibold">
                  {data.totalManualHours.toFixed(1)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">
                  With tydei
                </p>
                <p className="text-2xl font-semibold">
                  {data.totalAutomatedHours.toFixed(1)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Hours saved</p>
                <p className="text-2xl font-semibold text-emerald-700 dark:text-emerald-400">
                  {data.hoursSavedPerMonth.toFixed(1)}
                </p>
              </div>
            </div>
            <div className="space-y-1.5 pt-2">
              {data.breakdown
                .slice()
                .sort((a, b) => b.savedHours - a.savedHours)
                .map((b) => (
                  <div
                    key={b.task}
                    className="flex items-center justify-between text-xs"
                  >
                    <span className="text-muted-foreground">
                      {b.description}
                    </span>
                    <span className="font-mono">
                      {b.manualHours.toFixed(1)} → {b.automatedHours.toFixed(1)}
                      <span className="ml-2 text-emerald-700 dark:text-emerald-400">
                        −{b.savedHours.toFixed(1)}h
                      </span>
                    </span>
                  </div>
                ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
