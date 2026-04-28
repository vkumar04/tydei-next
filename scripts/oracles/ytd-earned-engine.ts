// scripts/oracles/ytd-earned-engine.ts
/**
 * YTD-earned oracle (engine-input layer).
 *
 * Closes the _gap_ cell in CLAUDE.md's invariants table for
 * `sumEarnedRebatesYTD`. The "ytd-earned" oracle (real-data) tests
 * the full DB path; this one tests the gate logic of the helper
 * itself with synthetic fixtures, so a regression that breaks the
 * `payPeriodEnd <= today AND >= startOfYear` filter is caught even
 * without DB access.
 *
 * Renamed from "ytd-earned" → "ytd-earned-engine" to avoid colliding
 * with the existing real-data oracle of the same name.
 */
import { defineOracle } from "./_shared/runner"
import {
  sumEarnedRebatesLifetime,
  sumEarnedRebatesYTD,
} from "@/lib/contracts/rebate-earned-filter"

const TODAY = new Date("2026-06-15T12:00:00Z")
const Y = 2026
const date = (iso: string) => new Date(iso)

interface Rebate {
  id: string
  rebateEarned: number
  rebateCollected: number
  payPeriodStart: Date | null
  payPeriodEnd: Date | null
  collectionDate: Date | null
}

const FIXTURES: Rebate[] = [
  // closed earlier this year — counts in YTD + lifetime
  { id: "a", rebateEarned: 100, rebateCollected: 0, payPeriodStart: date(`${Y}-01-01`), payPeriodEnd: date(`${Y}-03-31`), collectionDate: null },
  { id: "b", rebateEarned: 50,  rebateCollected: 0, payPeriodStart: date(`${Y}-04-01`), payPeriodEnd: date(`${Y}-04-30`), collectionDate: null },
  // closed last year — lifetime only, NOT YTD
  { id: "c", rebateEarned: 200, rebateCollected: 0, payPeriodStart: date(`${Y - 1}-10-01`), payPeriodEnd: date(`${Y - 1}-12-31`), collectionDate: null },
  // future-dated — neither
  { id: "d", rebateEarned: 999, rebateCollected: 0, payPeriodStart: date(`${Y}-12-01`), payPeriodEnd: date(`${Y + 1}-12-31`), collectionDate: null },
  // past today's date but pre-YTD-Jan-1 — lifetime only
  { id: "e", rebateEarned: 10,  rebateCollected: 0, payPeriodStart: date(`2024-01-01`), payPeriodEnd: date(`2024-01-31`), collectionDate: null },
  // null payPeriodEnd — neither (gate requires presence)
  { id: "f", rebateEarned: 7,   rebateCollected: 0, payPeriodStart: null, payPeriodEnd: null, collectionDate: null },
]

export default defineOracle("ytd-earned-engine", async (ctx) => {
  // Independent recompute (no shared helpers).
  const startOfYear = new Date(TODAY.getFullYear(), 0, 1)
  let oracleLifetime = 0
  let oracleYTD = 0
  for (const r of FIXTURES) {
    if (!r.payPeriodEnd) continue
    if (r.payPeriodEnd > TODAY) continue
    oracleLifetime += r.rebateEarned
    if (r.payPeriodEnd >= startOfYear) oracleYTD += r.rebateEarned
  }

  const appLifetime = sumEarnedRebatesLifetime(FIXTURES, TODAY)
  const appYTD = sumEarnedRebatesYTD(FIXTURES, TODAY)

  ctx.check(
    "lifetime: payPeriodEnd <= today",
    Math.abs(appLifetime - oracleLifetime) < 0.01,
    `oracle=${oracleLifetime} app=${appLifetime}`,
  )
  ctx.check(
    "YTD: payPeriodEnd <= today AND >= startOfYear",
    Math.abs(appYTD - oracleYTD) < 0.01,
    `oracle=${oracleYTD} app=${appYTD}`,
  )
  ctx.check(
    "lifetime ≥ YTD by definition",
    appLifetime >= appYTD,
    `lifetime=${appLifetime} ytd=${appYTD}`,
  )
  ctx.check(
    "future-dated rows excluded from both",
    // Lifetime = a(100) + b(50) + c(200) + e(10) = 360.  d/f excluded.
    // YTD     = a(100) + b(50) = 150.
    appLifetime === 360 && appYTD === 150,
    `expected lifetime=360 ytd=150, got lifetime=${appLifetime} ytd=${appYTD}`,
  )
  ctx.check(
    "null payPeriodEnd excluded from both",
    !FIXTURES.some(
      (r) => r.payPeriodEnd === null && (appLifetime === 167 || appYTD === 157),
    ),
    "row with null payPeriodEnd must NOT contribute",
  )
})
