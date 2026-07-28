/**
 * Pure-logic tests for the Per-Purchase Compliance Audit's truncation
 * disclosure (repo convention: component logic is tested as exported pure
 * functions — vitest runs in a node environment, so there is no render
 * testing).
 *
 * SCOPE BUG (2026-07-28), second half. `evaluatePurchaseCompliance` was
 * fixed to compute its totals over the whole window and to DISCLOSE its
 * display cap via `auditSampleLimit` / `auditSampleTruncated` /
 * `scanTruncated` — and the client then read none of the three. On top of
 * that it re-sliced the returned sample to 200 rows of its own, so:
 *
 *   • the DEFAULT view in production — Lighthouse Surgical Center holds
 *     3,760 COG rows in the trailing 90 days, 46,460 all-time — listed
 *     200 purchases under a card reading "… of 3,760 purchases", and the
 *     reader had no way to know the table and the cards described
 *     different sets;
 *   • a 409-row window (the demo seed, trailing year) came back complete
 *     and untruncated from the server, and the screen still dropped 209
 *     purchases with nothing saying so.
 *
 * These tests pin the disclosure: the notice names both counts and the
 * cap, it stays silent when the table really is showing everything, and
 * no rate or scope label is ever phrased against the capped sample.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it, expect } from "vitest"
import {
  buildAuditSampleNotice,
  buildScanCeilingNotice,
  buildComplianceRateSubtitle,
  buildViolationScopeLabel,
} from "@/components/facility/reports/compliance-report-client"

describe("buildAuditSampleNotice", () => {
  it("names both numbers and the cap when the table is a sample", () => {
    // Lighthouse Surgical Center, production snapshot, default 90-day
    // window: 3,760 COG rows, server audit sample capped at 500.
    const notice = buildAuditSampleNotice({
      shown: 500,
      totalPurchases: 3760,
      sampleLimit: 500,
      sampleTruncated: true,
      scanTruncated: false,
    })
    expect(notice).toContain("500 most recent of 3,760 purchases")
    expect(notice).toContain("capped at 500 rows")
  })

  it("says the headline counts are NOT capped with the table", () => {
    const notice = buildAuditSampleNotice({
      shown: 500,
      totalPurchases: 3760,
      sampleLimit: 500,
      sampleTruncated: true,
      scanTruncated: false,
    })
    // The compliance rate's denominator is the window, so the notice has
    // to stop the reader inferring the cards follow the table.
    expect(notice).toContain("computed over all 3,760")
  })

  it("says the sample is recency-ordered, not representative", () => {
    // The server walks the window `transactionDate desc`, so the cap
    // always eats the oldest purchases first. "500 of 3,760" alone reads
    // like a representative slice.
    const notice = buildAuditSampleNotice({
      shown: 500,
      totalPurchases: 3760,
      sampleLimit: 500,
      sampleTruncated: true,
      scanTruncated: false,
    })
    expect(notice).toContain("ordered newest-first")
    expect(notice).toContain("oldest purchases in the range are the ones missing")
  })

  it("fires on a client-side cap even when the server reports no truncation", () => {
    // This is the exact hole the old `.slice(0, 200)` opened: the server
    // returned all 409 rows of a trailing-year window with
    // auditSampleTruncated === false, and the screen still showed 200.
    const notice = buildAuditSampleNotice({
      shown: 200,
      totalPurchases: 409,
      sampleLimit: 500,
      sampleTruncated: false,
      scanTruncated: false,
    })
    expect(notice).not.toBeNull()
    expect(notice).toContain("200 most recent of 409 purchases")
  })

  it("never quotes a cap larger than the rows actually on screen", () => {
    // Same 200-of-409 shape. The server's limit was 500, but only 200
    // rows reached the table — "capped at 500 rows" beside a 200-row
    // table is the notice telling its own version of the lie.
    const notice = buildAuditSampleNotice({
      shown: 200,
      totalPurchases: 409,
      sampleLimit: 500,
      sampleTruncated: false,
      scanTruncated: false,
    })
    expect(notice).toContain("capped at 200 rows")
    expect(notice).not.toContain("capped at 500 rows")
  })

  it("stays silent when the table already shows every purchase", () => {
    // The default 90-day window holds 113 rows for the demo facility —
    // well inside the cap, so the screen must stay quiet.
    expect(
      buildAuditSampleNotice({
        shown: 113,
        totalPurchases: 113,
        sampleLimit: 500,
        sampleTruncated: false,
        scanTruncated: false,
      }),
    ).toBeNull()
    expect(
      buildAuditSampleNotice({
        shown: 0,
        totalPurchases: 0,
        sampleLimit: 500,
        sampleTruncated: false,
        scanTruncated: false,
      }),
    ).toBeNull()
  })

  it("falls back to the rendered count when the cap arrives unusable", () => {
    // `limit` is client-supplied; a non-finite one used to survive the
    // server's Math.min/Math.max clamp as NaN. The notice must never
    // print "capped at NaN rows".
    for (const sampleLimit of [undefined, null, Number.NaN]) {
      const notice = buildAuditSampleNotice({
        shown: 500,
        totalPurchases: 3760,
        sampleLimit,
        sampleTruncated: true,
        scanTruncated: false,
      })
      expect(notice).toContain("capped at 500 rows")
      expect(notice).not.toContain("NaN")
    }
  })

  it("stops calling the total a window total when the scan was partial", () => {
    // Under the runaway guard `totalPurchases` is the SCANNED prefix,
    // not the window. Saying "of 200,000 purchases in this window" and
    // "computed over all 200,000" would contradict the red banner
    // directly above it and re-label a partial scope as the whole.
    const notice = buildAuditSampleNotice({
      shown: 500,
      totalPurchases: 200000,
      sampleLimit: 500,
      sampleTruncated: true,
      scanTruncated: true,
    })
    expect(notice).toContain("200,000 purchases scanned")
    expect(notice).not.toContain("in this window —")
    expect(notice).toContain("only part of this window")
    expect(notice).toContain("oldest purchases scanned are the ones missing")
  })
})

describe("the Audit Detail table renders the whole returned sample", () => {
  // The pure functions above cannot see the JSX, and the original bug
  // WAS the JSX: `data.audits.slice(0, 200)`. Pin it at the source, in
  // the style of the repo's other source-scanning guards.
  const SOURCE = readFileSync(
    join(import.meta.dirname, "..", "compliance-report-client.tsx"),
    "utf8",
  )
  // Comments in that file quote the old `.slice(0, 200)` on purpose —
  // strip them before scanning, or the guard flags its own changelog.
  // (Same shape as `sourceWithoutComments` in
  // `lib/actions/admin/__tests__/admin-list-stat-scope.test.ts`.)
  const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(
    /^\s*\/\/.*$/gm,
    "",
  )

  it("never re-slices, splices or filters `audits` before rendering", () => {
    expect(CODE).not.toMatch(/audits\s*\.\s*(slice|splice|filter)\s*\(/)
  })

  it("passes the rendered row count to the notice, not a constant", () => {
    expect(CODE).toContain("shown: data.audits.length")
  })

  it("keys the empty state off the window total, not the sample", () => {
    // A capped-to-empty sample beside a non-zero total is a cap, not an
    // empty window, and must never read "No purchases".
    expect(CODE).toContain("data.totalPurchases === 0")
    expect(CODE).not.toMatch(/data\.audits\.length === 0\s*\?/)
  })
})

describe("buildScanCeilingNotice", () => {
  it("stays silent in the expected case", () => {
    expect(
      buildScanCeilingNotice({ scanTruncated: false, scanned: 1138 }),
    ).toBeNull()
  })

  it("says the MATH is partial, not just the table", () => {
    // The audit-sample cap truncates the display; the scan ceiling
    // truncates the denominator, which is a strictly louder claim.
    const notice = buildScanCeilingNotice({
      scanTruncated: true,
      scanned: 200000,
    })
    expect(notice).toContain("200,000 most recent purchases scanned")
    expect(notice).toContain("compliance rate included")
    expect(notice).toContain("not the whole window")
  })
})

describe("buildComplianceRateSubtitle", () => {
  it("names the window as the denominator's scope", () => {
    expect(
      buildComplianceRateSubtitle({
        compliantPurchases: 1024,
        totalPurchases: 3760,
        scanTruncated: false,
      }),
    ).toBe("1,024 of 3,760 purchases in this window")
  })

  it("stops calling the denominator a window total when the scan is partial", () => {
    const subtitle = buildComplianceRateSubtitle({
      compliantPurchases: 180000,
      totalPurchases: 200000,
      scanTruncated: true,
    })
    expect(subtitle).toContain("partial")
    expect(subtitle).not.toContain("in this window")
  })
})

describe("buildViolationScopeLabel", () => {
  it("says the counters cover every purchase, not the audit sample", () => {
    expect(buildViolationScopeLabel(false)).toBe(
      "violations · all purchases in this window",
    )
  })

  it("downgrades the claim when the scan was partial", () => {
    expect(buildViolationScopeLabel(true)).toBe(
      "violations · purchases scanned (partial)",
    )
  })
})
