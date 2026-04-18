"use client"

import Link from "next/link"
import { ArrowRight, AlertTriangle, FileText, Clock } from "lucide-react"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

/**
 * Three quick-access entry points on the reports hub:
 *   1. Full Reports (stays on page — acts as an anchor)
 *   2. Price Discrepancy (navigates to the drill-down page)
 *   3. Scheduled Reports (opens the schedule dialog)
 *
 * Reference: docs/superpowers/specs/2026-04-18-reports-hub-rewrite.md §4.5
 */
export interface ReportsQuickAccessCardsProps {
  onOpenScheduledReports: () => void
}

export function ReportsQuickAccessCards({
  onOpenScheduledReports,
}: ReportsQuickAccessCardsProps) {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <a href="#reports-tabs" className="block">
        <Card className="cursor-pointer transition-colors hover:bg-accent/50">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <FileText className="h-5 w-5 text-primary" />
              <Badge variant="outline">All Types</Badge>
            </div>
          </CardHeader>
          <CardContent>
            <h3 className="font-semibold">Full Reports</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Browse all 8 report tabs with vendor, contract, and date filters
            </p>
            <div className="mt-3 flex items-center gap-1 text-sm font-medium text-primary">
              Jump to reports <ArrowRight className="h-4 w-4" />
            </div>
          </CardContent>
        </Card>
      </a>

      <Link href="/dashboard/reports/price-discrepancy">
        <Card className="cursor-pointer border-red-200 transition-colors hover:bg-accent/50 dark:border-red-900">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <AlertTriangle className="h-5 w-5 text-red-500" />
              <Badge className="bg-red-100 text-red-700 hover:bg-red-100 dark:bg-red-900/30 dark:text-red-300 dark:hover:bg-red-900/30">
                Action Required
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <h3 className="font-semibold">Price Discrepancy</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Drill into pricing variances between contracts and actual purchases
            </p>
            <div className="mt-3 flex items-center gap-1 text-sm font-medium text-red-600 dark:text-red-400">
              View report <ArrowRight className="h-4 w-4" />
            </div>
          </CardContent>
        </Card>
      </Link>

      <button
        type="button"
        onClick={onOpenScheduledReports}
        className="text-left"
      >
        <Card className="cursor-pointer transition-colors hover:bg-accent/50">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <Clock className="h-5 w-5 text-primary" />
              <Badge variant="outline">Automation</Badge>
            </div>
          </CardHeader>
          <CardContent>
            <h3 className="font-semibold">Scheduled Reports</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Manage recurring report schedules and recipients
            </p>
            <div className="mt-3 flex items-center gap-1 text-sm font-medium text-primary">
              Manage schedules <ArrowRight className="h-4 w-4" />
            </div>
          </CardContent>
        </Card>
      </button>
    </div>
  )
}
