"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import Link from "next/link"
import { ChevronLeft, FileWarning } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { queryKeys } from "@/lib/query-keys"
import { formatNumber } from "@/lib/formatting"
import { evaluatePurchaseCompliance } from "@/lib/actions/analytics/purchase-compliance"

const TODAY_ISO = () => new Date().toISOString().slice(0, 10)
const NINETY_DAYS_AGO_ISO = () => {
  const d = new Date()
  d.setDate(d.getDate() - 90)
  return d.toISOString().slice(0, 10)
}

/**
 * Rows of `audits` we ask the server for. The server clamps this and
 * reports what it actually used as `auditSampleLimit`, which is the value
 * the notice below quotes — never this constant.
 *
 * The table renders the WHOLE sample the server returns. It used to
 * `.slice(0, 200)` on top of the cap, a second truncation nothing on the
 * page mentioned: the production snapshot's Lighthouse Surgical Center
 * has 3,760 COG rows inside the DEFAULT 90-day window (46,460 all-time),
 * so the screen opened on 200 visible purchases beneath a card reading
 * "… of 3,760 purchases". Even a window the server returns in full — 409
 * rows on the demo seed's trailing year — silently lost half its rows on
 * this side of the wire.
 */
const AUDIT_SAMPLE_LIMIT = 500

/**
 * Caption for the Audit Detail table when it lists fewer purchases than
 * the window holds. A silent cap is the bug; a labelled one is a feature.
 *
 * Fires on the server's `auditSampleTruncated` OR on the rendered row
 * count falling short of `totalPurchases` — the second half catches any
 * cap applied on this side of the wire, which is exactly how the first
 * version of this screen hid 200-of-409.
 *
 * The sample is not merely short, it is ORDERED: the server walks the
 * window `transactionDate desc`, so the rows that survive the cap are the
 * most recent ones and the oldest purchases in the window are the first
 * to fall off. Saying only "showing 500 of 3,760" would invite the reader
 * to treat the visible rows as a representative slice.
 *
 * Returns null when the table already shows every purchase, so the UI
 * stays quiet on small windows (≈112 rows in the demo seed's default
 * 90-day range, counted 2026-07-28 — it drifts by a row a day as the
 * window slides).
 *
 * When `scanTruncated` is set, `totalPurchases` is only the scanned
 * prefix, so the copy switches from "in this window" to "scanned" —
 * otherwise this notice would quietly re-label a partial scope as the
 * whole one directly under the banner that says it isn't.
 */
export function buildAuditSampleNotice(input: {
  shown: number
  totalPurchases: number
  sampleLimit: number | null | undefined
  sampleTruncated: boolean
  /**
   * The runaway guard tripped, so `totalPurchases` is NOT the window's
   * total — it is the prefix that was scanned. Required (not optional)
   * on purpose: this notice's whole job is naming a scope, and a caller
   * that hasn't decided which scope it holds must not compile.
   */
  scanTruncated: boolean
}): string | null {
  const { shown, totalPurchases, scanTruncated } = input
  const hidden = totalPurchases - shown
  if (!input.sampleTruncated && hidden <= 0) return null

  // The server's clamped cap is the honest number to quote; fall back to
  // the rendered count if it ever arrives missing or non-finite.
  const reportedCap =
    typeof input.sampleLimit === "number" && Number.isFinite(input.sampleLimit)
      ? input.sampleLimit
      : shown
  // Never quote a cap larger than the table itself. If the row count
  // falls short of the server's limit, something on this side trimmed
  // it and THAT is the cap the reader is looking at — quoting the
  // server's larger number would overstate what is on screen, which is
  // the same class of lie the notice exists to prevent.
  const cap = Math.min(reportedCap, shown)

  // `totalPurchases` is the whole window only when the scan reached the
  // end of it. Under the runaway guard it counts the scanned prefix, so
  // the notice must stop calling it "purchases in this window" and must
  // stop claiming the cards cover everything — the red scan banner owns
  // that caveat and this text has to agree with it.
  const scope = scanTruncated ? "purchases scanned" : "purchases in this window"
  const missing = scanTruncated
    ? "the oldest purchases scanned are the ones missing"
    : "the oldest purchases in the range are the ones missing"
  const ordering =
    hidden > 0
      ? ` and ordered newest-first, so ${missing}`
      : ` and ordered newest-first`
  const totalsClaim = scanTruncated
    ? `The compliance rate and the Critical / Warning / By Type counts above ` +
      `are computed over all ${formatNumber(totalPurchases)} scanned — which ` +
      `is itself only part of this window, see the warning above.`
    : `The compliance rate and the Critical / Warning / By Type counts above ` +
      `are computed over all ${formatNumber(totalPurchases)}.`

  return (
    `Showing the ${formatNumber(shown)} most recent of ` +
    `${formatNumber(totalPurchases)} ${scope} — the audit ` +
    `table is capped at ${formatNumber(cap)} rows${ordering}. ` +
    totalsClaim
  )
}

/**
 * Banner for the runaway-scan guard. Unlike the sample cap, this one
 * truncates the MATH: when it trips, every headline number on the page —
 * the compliance rate included — covers only the purchases that were
 * scanned. Expected to be null; loud when it isn't.
 */
export function buildScanCeilingNotice(input: {
  scanTruncated: boolean
  scanned: number
}): string | null {
  if (!input.scanTruncated) return null
  return (
    `This window holds more purchases than a single audit pass will scan. ` +
    `Every figure on this page — the compliance rate included — covers only ` +
    `the ${formatNumber(input.scanned)} most recent purchases scanned, not ` +
    `the whole window. Narrow the date range to audit the rest.`
  )
}

/**
 * Subtitle under the Compliance Rate figure. The denominator is the whole
 * window, so it says so; when the scan guard trips the same denominator
 * is only a floor, and the wording has to stop calling it a total.
 */
export function buildComplianceRateSubtitle(input: {
  compliantPurchases: number
  totalPurchases: number
  scanTruncated: boolean
}): string {
  const pair = `${formatNumber(input.compliantPurchases)} of ${formatNumber(
    input.totalPurchases,
  )} purchases`
  return input.scanTruncated
    ? `${pair} scanned — partial window`
    : `${pair} in this window`
}

/**
 * Scope word for the Critical / Warning violation cards. They count over
 * every purchase in the window, never over the audit sample below them —
 * a reader who sees a 500-row table under a "1,204 violations" card needs
 * the card to say which set it counted.
 */
export function buildViolationScopeLabel(scanTruncated: boolean): string {
  return scanTruncated
    ? "violations · purchases scanned (partial)"
    : "violations · all purchases in this window"
}

function severityBadge(s: "ACCEPTABLE" | "WARNING" | "CRITICAL") {
  if (s === "CRITICAL") return <Badge variant="destructive">Critical</Badge>
  if (s === "WARNING") return <Badge variant="secondary">Warning</Badge>
  return <Badge variant="default">OK</Badge>
}

export function ComplianceReportClient({ facilityId }: { facilityId: string }) {
  const [from, setFrom] = useState<string>(NINETY_DAYS_AGO_ISO())
  const [to, setTo] = useState<string>(TODAY_ISO())

  const { data, isLoading, isFetching } = useQuery({
    queryKey: queryKeys.analytics.purchaseCompliance(facilityId, { from, to }),
    queryFn: () =>
      evaluatePurchaseCompliance({
        fromDate: from,
        toDate: to,
        limit: AUDIT_SAMPLE_LIMIT,
      }),
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
  })

  // Derived, not mirrored — both notices are a pure function of `data`.
  const sampleNotice = data
    ? buildAuditSampleNotice({
        shown: data.audits.length,
        totalPurchases: data.totalPurchases,
        sampleLimit: data.auditSampleLimit,
        sampleTruncated: data.auditSampleTruncated,
        scanTruncated: data.scanTruncated,
      })
    : null
  const scanNotice = data
    ? buildScanCeilingNotice({
        scanTruncated: data.scanTruncated,
        scanned: data.totalPurchases,
      })
    : null

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-4">
          <Link href="/dashboard/reports">
            <Button variant="ghost" size="sm">
              <ChevronLeft className="mr-1 h-4 w-4" />
              Reports
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              Per-Purchase Compliance Audit
            </h1>
            <p className="text-sm text-muted-foreground">
              Off-contract vendors, out-of-period purchases, unapproved items,
              and significant price variance.
            </p>
          </div>
        </div>
        <div className="flex items-end gap-3">
          <div className="grid gap-1">
            <Label className="text-xs" htmlFor="from">
              From
            </Label>
            <Input
              id="from"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="w-40"
            />
          </div>
          <div className="grid gap-1">
            <Label className="text-xs" htmlFor="to">
              To
            </Label>
            <Input
              id="to"
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="w-40"
            />
          </div>
        </div>
      </div>

      {isLoading || !data ? (
        <Skeleton className="h-32 w-full" />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">
                Compliance Rate
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{data.complianceRatePct}%</div>
              {/* The denominator is the whole window, never the capped
                  audit sample below — name the scope so the two row
                  counts on this page can't be read as the same set. */}
              <p className="text-xs text-muted-foreground">
                {buildComplianceRateSubtitle({
                  compliantPurchases: data.compliantPurchases,
                  totalPurchases: data.totalPurchases,
                  scanTruncated: data.scanTruncated,
                })}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Critical</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-destructive">
                {formatNumber(data.criticalCount)}
              </div>
              <p className="text-xs text-muted-foreground">
                {buildViolationScopeLabel(data.scanTruncated)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Warnings</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">
                {formatNumber(data.warningCount)}
              </div>
              <p className="text-xs text-muted-foreground">
                {buildViolationScopeLabel(data.scanTruncated)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">By Type</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-1 text-xs">
                {Object.entries(data.byType).map(([t, n]) => (
                  <div key={t} className="flex justify-between">
                    <span className="text-muted-foreground">
                      {t.replace(/_/g, " ").toLowerCase()}
                    </span>
                    <span className="font-mono">{formatNumber(n)}</span>
                  </div>
                ))}
                {Object.keys(data.byType).length === 0 ? (
                  <span className="text-muted-foreground">No violations</span>
                ) : null}
              </div>
              {/* Same scope as the Critical / Warning cards — every
                  purchase counted, not the capped sample below. The
                  truncation notice promises the reader these three
                  cards share a denominator, so all three have to say
                  which one. */}
              <p className="mt-2 text-xs text-muted-foreground">
                {buildViolationScopeLabel(data.scanTruncated)}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* The scan guard truncates the MATH, so it belongs above the cards
          it invalidates rather than beside the table. */}
      {scanNotice && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          <FileWarning className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{scanNotice}</span>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>
            Audit Detail{" "}
            {isFetching ? (
              <span className="ml-2 text-xs text-muted-foreground">
                refreshing…
              </span>
            ) : null}
          </CardTitle>
          {sampleNotice && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
              <FileWarning className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{sampleNotice}</span>
            </div>
          )}
        </CardHeader>
        <CardContent>
          {isLoading || !data ? (
            <Skeleton className="h-64 w-full" />
          ) : data.totalPurchases === 0 ? (
            // Keyed off the window total, not the sample: an empty sample
            // beside a non-zero total is a cap, not an empty window, and
            // must not be reported as "no purchases".
            <p className="py-12 text-center text-sm text-muted-foreground">
              No purchases in the selected window.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">Unit $</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Violations</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {/* The whole sample the server returned — no second cap
                    on this side. `sampleNotice` labels the one that's
                    left. */}
                {data.audits.map((a) => (
                  <TableRow key={a.cogId}>
                    <TableCell className="font-mono text-xs">
                      {a.transactionDate.slice(0, 10)}
                    </TableCell>
                    <TableCell>{a.vendorName ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {a.vendorItemNo ?? "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      ${a.unitCost.toFixed(2)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {a.quantity}
                    </TableCell>
                    <TableCell>
                      {a.isCompliant ? (
                        <Badge variant="default">OK</Badge>
                      ) : (
                        <Badge variant="destructive">Violation</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {a.violations.length === 0 ? (
                        <span className="text-xs text-muted-foreground">—</span>
                      ) : (
                        <div className="flex flex-col gap-1">
                          {a.violations.map((v, i) => (
                            <div
                              key={i}
                              className="flex items-center gap-2 text-xs"
                            >
                              {severityBadge(v.severity)}
                              <span>{v.message}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
