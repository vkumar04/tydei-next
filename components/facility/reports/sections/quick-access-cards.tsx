"use client"

import Link from "next/link"
import {
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  AlertTriangle,
  ArrowRight,
  DollarSign,
  ShieldCheck,
  TrendingUp,
} from "lucide-react"

/* ─── Component ──────────────────────────────────────────────── */

export function QuickAccessCards() {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <Link href="/dashboard/reports/price-discrepancy">
        <Card className="cursor-pointer transition-colors hover:bg-accent/50 border-red-200 dark:border-red-900">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <AlertTriangle className="h-5 w-5 text-red-500" />
              <Badge className="bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/30">
                Action Required
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <h3 className="font-semibold">Price Discrepancy Report</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Identify pricing variances between contracts and actual purchases
            </p>
            <div className="flex items-center gap-1 mt-3 text-sm text-red-600 dark:text-red-400 font-medium">
              View Report <ArrowRight className="h-4 w-4" />
            </div>
          </CardContent>
        </Card>
      </Link>
      <Link href="/dashboard/analysis">
        <Card className="cursor-pointer transition-colors hover:bg-accent/50">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <TrendingUp className="h-5 w-5 text-primary" />
              <Badge variant="outline">Analysis</Badge>
            </div>
          </CardHeader>
          <CardContent>
            <h3 className="font-semibold">Contract Analysis</h3>
            <p className="text-sm text-muted-foreground mt-1">
              NPV, IRR, and prospective contract evaluation
            </p>
            <div className="flex items-center gap-1 mt-3 text-sm text-primary font-medium">
              View Analysis <ArrowRight className="h-4 w-4" />
            </div>
          </CardContent>
        </Card>
      </Link>
      <Link href="/dashboard/reports/compliance">
        <Card className="cursor-pointer transition-colors hover:bg-accent/50">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <ShieldCheck className="h-5 w-5 text-primary" />
              <Badge variant="outline">Compliance</Badge>
            </div>
          </CardHeader>
          <CardContent>
            <h3 className="font-semibold">Per-Purchase Audit</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Off-contract vendors, out-of-period purchases, unapproved items
            </p>
            <div className="flex items-center gap-1 mt-3 text-sm text-primary font-medium">
              Run Audit <ArrowRight className="h-4 w-4" />
            </div>
          </CardContent>
        </Card>
      </Link>
      <Link href="/dashboard/case-costing">
        <Card className="cursor-pointer transition-colors hover:bg-accent/50">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <DollarSign className="h-5 w-5 text-primary" />
              <Badge variant="outline">Performance</Badge>
            </div>
          </CardHeader>
          <CardContent>
            <h3 className="font-semibold">Surgeon Scorecard</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Performance metrics and margin analysis by surgeon
            </p>
            <div className="flex items-center gap-1 mt-3 text-sm text-primary font-medium">
              View Scorecard <ArrowRight className="h-4 w-4" />
            </div>
          </CardContent>
        </Card>
      </Link>
    </div>
  )
}
