"use server"

import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"

export interface DeriveFromCOGResult {
  /**
   * Total spend across the contract's effective window. When
   * effective/expiration are supplied this is the sum across that
   * window (invoice history + projected run-rate for future-dated
   * months); when absent, falls back to the trailing-12mo aggregate
   * (legacy behavior).
   */
  totalValue: number
  /** Trailing 12-month COG aggregate — the annualized spend rate. */
  annualValue: number
  /** Number of months observed for the annual aggregate (always 12 by default). */
  monthsObserved: number
  /**
   * Number of months in the contract window used for `totalValue`.
   * `null` when no window was provided (falls back to annual).
   */
  windowMonthsObserved: number | null
}

export interface DeriveFromCOGOptions {
  /** Contract effective date (ISO string or Date). */
  effectiveDate?: string | Date | null
  /** Contract expiration date (ISO string or Date). */
  expirationDate?: string | Date | null
  /** Trailing window for `annualValue`. Defaults to 12. */
  annualWindowMonths?: number
}

function toDate(d: string | Date | null | undefined): Date | null {
  if (!d) return null
  if (d instanceof Date) return d
  const parsed = new Date(d)
  return Number.isFinite(parsed.getTime()) ? parsed : null
}

function monthsBetween(start: Date, end: Date): number {
  const MS_PER_MONTH = 30.4375 * 24 * 60 * 60 * 1000
  return Math.max(0, (end.getTime() - start.getTime()) / MS_PER_MONTH)
}

/**
 * Derive a contract's `totalValue` + `annualValue` from historical COG
 * spend for the given vendor.
 *
 * ─── Charles W1.W-A3b ──────────────────────────────────────────────
 *   Annual  = trailing 12 months of COG (the "run rate")
 *   Total   = sum across the contract's effective → expiration window
 *
 * The pre-W1.W implementation set `totalValue = annualValue`, which
 * under-quoted multi-year contracts by a factor equal to the number of
 * years in the window. For a 5-year contract running 2024-01 → 2028-12
 * with $1M/yr trailing, `totalValue` should be ≈$5M, not $1M.
 *
 * When `effectiveDate` / `expirationDate` are not provided we fall
 * back to the legacy behavior (total = annual = trailing 12mo) so the
 * function stays useful in form-open flows where the user hasn't
 * entered dates yet.
 *
 * Signature kept backward-compatible — the second positional arg
 * still accepts a plain number (interpreted as `annualWindowMonths`).
 */
export async function deriveContractTotalFromCOG(
  vendorId: string,
  optsOrMonths: number | DeriveFromCOGOptions = 12,
): Promise<DeriveFromCOGResult> {
  const opts: DeriveFromCOGOptions =
    typeof optsOrMonths === "number"
      ? { annualWindowMonths: optsOrMonths }
      : optsOrMonths
  const annualWindowMonths = opts.annualWindowMonths ?? 12

  const { facility } = await requireFacility()

  // 1. Trailing N-month aggregate (annualValue).
  const annualSince = new Date()
  annualSince.setMonth(annualSince.getMonth() - annualWindowMonths)

  const annualAgg = await prisma.cOGRecord.aggregate({
    where: {
      facilityId: facility.id,
      vendorId,
      transactionDate: { gte: annualSince },
    },
    _sum: { extendedPrice: true },
  })
  const annualValue = Number(annualAgg._sum.extendedPrice ?? 0)

  // 2. Contract-window aggregate (totalValue). When the caller doesn't
  //    know the window, fall back to the annual value. This matches the
  //    legacy surface so callers without effective/expiration keep
  //    working.
  const effective = toDate(opts.effectiveDate)
  const expiration = toDate(opts.expirationDate)

  let totalValue = annualValue
  let windowMonthsObserved: number | null = null

  if (effective && expiration && expiration.getTime() > effective.getTime()) {
    const now = new Date()
    const historicalEnd = expiration.getTime() < now.getTime() ? expiration : now
    windowMonthsObserved = monthsBetween(effective, expiration)

    if (historicalEnd.getTime() > effective.getTime()) {
      const windowAgg = await prisma.cOGRecord.aggregate({
        where: {
          facilityId: facility.id,
          vendorId,
          transactionDate: { gte: effective, lte: historicalEnd },
        },
        _sum: { extendedPrice: true },
      })
      const historicalSpend = Number(windowAgg._sum.extendedPrice ?? 0)
      const historicalMonths = monthsBetween(effective, historicalEnd)
      const windowMonths = monthsBetween(effective, expiration)

      if (
        historicalSpend > 0 &&
        historicalMonths > 0 &&
        windowMonths > historicalMonths
      ) {
        // Partial coverage: extrapolate observed run-rate across the
        // remainder of the window. e.g. 6 months invoiced at $500K →
        // projected 2-year total = $500K * (24 / 6) = $2M.
        totalValue = (historicalSpend / historicalMonths) * windowMonths
      } else {
        totalValue = historicalSpend
      }
    } else if (annualValue > 0) {
      // Forward-dated contract — no historical COG inside the window
      // yet. Project from the trailing-12mo annual rate.
      const windowMonths = monthsBetween(effective, expiration)
      totalValue = (annualValue / annualWindowMonths) * windowMonths
    }
  }

  return {
    totalValue: Math.round(totalValue * 100) / 100,
    annualValue: Math.round(annualValue * 100) / 100,
    monthsObserved: annualWindowMonths,
    windowMonthsObserved,
  }
}
