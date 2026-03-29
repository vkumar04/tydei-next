"use client"

import { useMemo } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Clock, Building2, TrendingUp } from "lucide-react"
import type { ExpiringContract } from "@/lib/actions/renewals"

interface VendorRenewalPipelineProps {
  contracts: ExpiringContract[]
}

export function VendorRenewalPipeline({ contracts }: VendorRenewalPipelineProps) {
  const { urgent, upcoming, planning } = useMemo(() => ({
    urgent: contracts.filter((c) => c.daysUntilExpiry <= 30),
    upcoming: contracts.filter((c) => c.daysUntilExpiry > 30 && c.daysUntilExpiry <= 60),
    planning: contracts.filter((c) => c.daysUntilExpiry > 60),
  }), [contracts])

  const renderContracts = (items: ExpiringContract[]) =>
    items.length === 0 ? (
      <p className="py-8 text-center text-sm text-muted-foreground">No contracts in this stage</p>
    ) : (
      <div className="space-y-3">
        {items.map((c) => (
          <Card key={c.id}>
            <CardContent className="pt-4">
              <div className="flex items-start justify-between">
                <div className="space-y-1">
                  <p className="text-sm font-medium">{c.name}</p>
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Building2 className="size-3" />
                    {c.facilityName ?? "N/A"}
                  </div>
                </div>
                <Badge variant={c.daysUntilExpiry <= 30 ? "destructive" : "secondary"}>
                  <Clock className="mr-1 size-3" />
                  {c.daysUntilExpiry}d
                </Badge>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
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
              <Progress
                value={100 - (c.daysUntilExpiry / 120) * 100}
                className="mt-3 h-1.5"
              />
            </CardContent>
          </Card>
        ))}
      </div>
    )

  return (
    <Tabs defaultValue="urgent">
      <TabsList>
        <TabsTrigger value="urgent">
          Urgent ({urgent.length})
        </TabsTrigger>
        <TabsTrigger value="upcoming">
          Upcoming ({upcoming.length})
        </TabsTrigger>
        <TabsTrigger value="planning">
          Planning ({planning.length})
        </TabsTrigger>
      </TabsList>
      <TabsContent value="urgent" className="mt-4">{renderContracts(urgent)}</TabsContent>
      <TabsContent value="upcoming" className="mt-4">{renderContracts(upcoming)}</TabsContent>
      <TabsContent value="planning" className="mt-4">{renderContracts(planning)}</TabsContent>
    </Tabs>
  )
}
