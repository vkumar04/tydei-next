"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { AICredit, AIUsageRecord } from "@/lib/actions/ai-credits"

interface CreditUsageCardProps {
  credits: AICredit
  usageRecords: AIUsageRecord[]
}

const tierLabels: Record<string, string> = {
  starter: "Starter",
  professional: "Professional",
  enterprise: "Enterprise",
  unlimited: "Unlimited",
}

export function CreditUsageCard({ credits, usageRecords }: CreditUsageCardProps) {
  const total = credits.monthlyCredits + credits.rolloverCredits
  const pct = total > 0 ? Math.round((credits.remaining / total) * 100) : 0

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            AI Credits — {tierLabels[credits.tierId] ?? credits.tierId}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              {credits.remaining} / {total} remaining
            </span>
            <span className="text-muted-foreground">{pct}%</span>
          </div>
          <Progress value={pct} className="h-2" />
          <p className="text-xs text-muted-foreground">
            Period: {credits.billingPeriodStart} to {credits.billingPeriodEnd}
          </p>
        </CardContent>
      </Card>

      {usageRecords.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Recent Usage</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Action</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead className="text-right">Credits</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {usageRecords.slice(0, 10).map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-xs">{r.description}</TableCell>
                    <TableCell className="text-xs">{r.userName}</TableCell>
                    <TableCell className="text-right text-xs">
                      -{r.creditsUsed}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(r.createdAt).toLocaleDateString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
