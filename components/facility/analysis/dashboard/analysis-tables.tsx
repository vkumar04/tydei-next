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
import { Checkbox } from "@/components/ui/checkbox"
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

/**
 * Optional row-selection for scoping the deal base to chosen categories/vendors
 * (Vick 2026-06-21). When provided, the table grows a leading checkbox column +
 * a select-all header checkbox. Omit it and the table renders exactly as before.
 */
export interface TableSelection {
  isSelected: (name: string) => boolean
  onToggle: (name: string) => void
  allSelected: boolean
  onToggleAll: () => void
}

/** Fixed-height scroll region so the side-by-side cards stay aligned while a
 *  long list scrolls. The header stays pinned via sticky positioning. */
const SCROLL = "h-[360px] overflow-y-auto"
const STICKY_HEAD = "sticky top-0 z-10 bg-card"

export function CategoryAspTable({
  rows,
  selection,
}: {
  rows: CategoryAspRow[]
  selection?: TableSelection
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Category Spend &amp; ASP</CardTitle>
        <p className="text-sm text-muted-foreground">
          {selection
            ? "Average selling price and spend by category. Check the categories to include in the deal model."
            : "Average selling price and spend by category."}
        </p>
      </CardHeader>
      <CardContent>
        <div className={SCROLL}>
        <Table>
          <TableHeader className={STICKY_HEAD}>
            <TableRow>
              {selection ? (
                <TableHead className="w-8">
                  <Checkbox
                    checked={selection.allSelected}
                    onCheckedChange={selection.onToggleAll}
                    aria-label="Select all categories"
                  />
                </TableHead>
              ) : null}
              <TableHead>Category</TableHead>
              <TableHead className="text-right">Spend</TableHead>
              <TableHead className="text-right">ASP</TableHead>
              <TableHead className="text-right">Share</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.category}>
                {selection ? (
                  <TableCell className="w-8">
                    <Checkbox
                      checked={selection.isSelected(row.category)}
                      onCheckedChange={() => selection.onToggle(row.category)}
                      aria-label={`Include ${row.category}`}
                    />
                  </TableCell>
                ) : null}
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
        </div>
      </CardContent>
    </Card>
  )
}

export function VendorMarketShareTable({
  rows,
  selection,
}: {
  rows: VendorShareRow[]
  selection?: TableSelection
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Vendor Market Share</CardTitle>
        <p className="text-sm text-muted-foreground">
          {selection
            ? "Spend concentration across suppliers. Check the vendors to include in the deal model."
            : "Spend concentration across suppliers."}
        </p>
      </CardHeader>
      <CardContent>
        <div className={SCROLL}>
        <Table>
          <TableHeader className={STICKY_HEAD}>
            <TableRow>
              {selection ? (
                <TableHead className="w-8">
                  <Checkbox
                    checked={selection.allSelected}
                    onCheckedChange={selection.onToggleAll}
                    aria-label="Select all vendors"
                  />
                </TableHead>
              ) : null}
              <TableHead>Vendor</TableHead>
              <TableHead className="text-right">Spend</TableHead>
              <TableHead className="text-right">Share</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.vendor}>
                {selection ? (
                  <TableCell className="w-8">
                    <Checkbox
                      checked={selection.isSelected(row.vendor)}
                      onCheckedChange={() => selection.onToggle(row.vendor)}
                      aria-label={`Include ${row.vendor}`}
                    />
                  </TableCell>
                ) : null}
                <TableCell className="font-medium">{row.vendor}</TableCell>
                <TableCell className={NUM}>{usdCompact(row.spend)}</TableCell>
                <TableCell className={NUM}>
                  {pctFromFraction(row.share)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        </div>
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
