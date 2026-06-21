"use client"

/**
 * Facility Analysis dashboard — presentational tables.
 *
 * Four PURE table/card components. No state, no fetching, no math — they take
 * already-computed rows from {@link buildDashboardModel} and render shadcn
 * tables in the financial-dashboard look (muted subtitles, right-aligned
 * tabular-nums numeric columns).
 */

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  usdCompact,
  usdDelta,
  pctFromFraction,
} from "@/components/facility/analysis/dashboard/format"
import { formatCurrency, formatNumber } from "@/lib/formatting"
import type {
  CategoryAspRow,
  VendorShareRow,
  ContributionMarginRow,
  CategoryImpactRow,
} from "@/components/facility/analysis/dashboard/model"

const NUM = "text-right tabular-nums"

export function CategoryAspTable({ rows }: { rows: CategoryAspRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Category Spend &amp; ASP</CardTitle>
        <p className="text-sm text-muted-foreground">
          Average selling price and spend by category.
        </p>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Category</TableHead>
              <TableHead className="text-right">Spend</TableHead>
              <TableHead className="text-right">ASP</TableHead>
              <TableHead className="text-right">Share</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.category}>
                <TableCell className="font-medium">{row.category}</TableCell>
                <TableCell className={NUM}>{usdCompact(row.spend)}</TableCell>
                <TableCell className={NUM}>
                  {formatCurrency(row.asp)}
                </TableCell>
                <TableCell className={NUM}>
                  {pctFromFraction(row.share)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

export function VendorMarketShareTable({ rows }: { rows: VendorShareRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Vendor Market Share</CardTitle>
        <p className="text-sm text-muted-foreground">
          Spend concentration across suppliers.
        </p>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Vendor</TableHead>
              <TableHead className="text-right">Spend</TableHead>
              <TableHead className="text-right">Share</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.vendor}>
                <TableCell className="font-medium">{row.vendor}</TableCell>
                <TableCell className={NUM}>{usdCompact(row.spend)}</TableCell>
                <TableCell className={NUM}>
                  {pctFromFraction(row.share)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

export function ContributionMarginTable({
  rows,
}: {
  rows: ContributionMarginRow[]
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Contribution Margin by Procedure</CardTitle>
        <p className="text-sm text-muted-foreground">
          Modeled revenue less supply cost per procedure category.
        </p>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Procedure</TableHead>
              <TableHead className="text-right">Cases</TableHead>
              <TableHead className="text-right">Supply / Case</TableHead>
              <TableHead className="text-right">Contribution Margin</TableHead>
              <TableHead className="text-right">Margin %</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.procedure}>
                <TableCell className="font-medium">{row.procedure}</TableCell>
                <TableCell className={NUM}>{formatNumber(row.cases)}</TableCell>
                <TableCell className={NUM}>
                  {formatCurrency(row.supplyPerCase)}
                </TableCell>
                <TableCell className={NUM}>
                  {usdCompact(row.contributionMargin)}
                </TableCell>
                <TableCell className={NUM}>
                  {pctFromFraction(row.marginPct, 0)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

export function IndividualImpactTable({
  rows,
}: {
  rows: CategoryImpactRow[]
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Individual Impact by Category &amp; Case</CardTitle>
        <p className="text-sm text-muted-foreground">
          How the savings allocate across categories, in margin points and
          dollars.
        </p>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Category</TableHead>
              <TableHead className="text-right">Cases</TableHead>
              <TableHead className="text-right">Annual Impact</TableHead>
              <TableHead className="text-right">$ / Case</TableHead>
              <TableHead className="text-right">Margin %</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.category}>
                <TableCell className="font-medium">{row.category}</TableCell>
                <TableCell className={NUM}>{formatNumber(row.cases)}</TableCell>
                <TableCell
                  className={
                    row.annualImpact > 0
                      ? `${NUM} text-emerald-600`
                      : NUM
                  }
                >
                  {usdDelta(row.annualImpact)}
                </TableCell>
                <TableCell className={NUM}>
                  {formatCurrency(row.impactPerCase)}
                </TableCell>
                <TableCell className={NUM}>
                  {pctFromFraction(row.marginPct, 0)} →{" "}
                  {pctFromFraction(row.newMarginPct, 1)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
