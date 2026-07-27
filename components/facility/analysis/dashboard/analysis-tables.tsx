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
/** Unknowable cell (e.g. a per-case figure with no case volume) — not a zero. */
const EMPTY_CELL = "—"

/** Fixed-height scroll region so the side-by-side cards stay aligned while a
 *  long list scrolls. The header stays pinned via sticky positioning. */
const SCROLL = "h-[360px] overflow-y-auto"
const STICKY_HEAD = "sticky top-0 z-10 bg-card"

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
        <div className={SCROLL}>
        <Table>
          <TableHeader className={STICKY_HEAD}>
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
        </div>
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
        <div className={SCROLL}>
        <Table>
          <TableHeader className={STICKY_HEAD}>
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
        {/* Charles 2026-07-27 ("everything is 0"): a facility with no
            case-costing data has no per-case figures, and rendering those as a
            literal "0 / $0" reads as broken data rather than absent data. Show
            an em-dash for the genuinely-unknowable cells; the revenue-derived
            columns beside them are real and must still render. */}
        {rows.length > 0 && rows.every((r) => r.cases === 0) && (
          <p className="mb-3 rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
            No case volume on file — per-case columns are unavailable. Import
            case-costing data, or set{" "}
            <span className="font-medium">Annual cases</span> in Financial
            Assumptions above.
          </p>
        )}
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
                <TableCell className={NUM}>
                  {row.cases > 0 ? formatNumber(row.cases) : EMPTY_CELL}
                </TableCell>
                <TableCell className={NUM}>
                  {row.cases > 0 ? formatCurrency(row.supplyPerCase) : EMPTY_CELL}
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
                {/* See ContributionMarginTable — an unknown per-case figure is
                    an em-dash, not a zero. Annual Impact beside it is
                    spend-derived and stays real. */}
                <TableCell className={NUM}>
                  {row.cases > 0 ? formatNumber(row.cases) : EMPTY_CELL}
                </TableCell>
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
                  {row.cases > 0 ? formatCurrency(row.impactPerCase) : EMPTY_CELL}
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
