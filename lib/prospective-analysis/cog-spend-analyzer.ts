/**
 * Prospective analysis — COG spend-pattern analyzer (spec §subsystem-8,
 * docs/superpowers/specs/2026-04-18-prospective-analysis-rewrite.md).
 *
 * PURE FUNCTION: takes vendor purchases + pricing-file rows and returns a
 * SpendPatternAnalysis. No IO, no prisma imports. Runs alongside Charles's
 * vendor/facility prospective engines.
 *
 * What it surfaces (all derived from last-12-months purchases relative to a
 * reference date — defaulting to the max purchase date when unspecified):
 *   totalSpend12Mo          sum of extendedPrice within the 12-month window
 *   monthlyStdevPct         populational stdev of monthly spend / mean × 100
 *   seasonalityFlag         monthlyStdevPct > 20 (buffer-stock flag)
 *   top5ItemsBySpend        top 5 vendor items by summed spend, desc
 *   priceDriftVsPricingFile avg (avgPurchasePrice - contractPrice) / contractPrice × 100
 *                           across pricing-file items that appear in purchases.
 *                           Approximation — we lack quantity, so avgPurchasePrice
 *                           is computed as sumExtendedPrice / countOfPurchases.
 *                           Clamps to 0 when no pricing-file matches.
 *   categoryMarketShare     totalSpend12Mo / categoryTotalSpend12Mo, in [0..1]
 *   tieInRiskFlag           categoryMarketShare > 0.4
 */

export interface CogPurchase {
  transactionDate: Date;
  extendedPrice: number;
  vendorId: string;
  vendorItemNo?: string | null;
  productDescription?: string | null;
  productCategory?: string | null;
}

export interface PricingFileRow {
  vendorItemNo: string;
  contractPrice: number;
}

export interface SpendPatternAnalysis {
  vendorId: string;
  totalSpend12Mo: number;
  monthlyStdevPct: number;
  seasonalityFlag: boolean;
  top5ItemsBySpend: Array<{
    vendorItemNo: string;
    description: string;
    spend: number;
  }>;
  priceDriftVsPricingFile: number;
  categoryMarketShare: number;
  tieInRiskFlag: boolean;
}

export interface AnalyzeCOGSpendPatternsInput {
  vendorId: string;
  purchases: CogPurchase[];
  pricingFile: PricingFileRow[];
  /** Category-wide 12-month spend across all vendors (for market-share). */
  categoryTotalSpend12Mo?: number;
  /** Reference date — defaults to max purchase date in input, else new Date(). */
  referenceDate?: Date;
}

const SEASONALITY_PCT_THRESHOLD = 20;
const TIE_IN_SHARE_THRESHOLD = 0.4;
const TOP_ITEM_COUNT = 5;

/**
 * Return the instant 12 months before `reference` (inclusive lower bound).
 * Mirrors JS Date month arithmetic — Feb-29 input maps to Feb-28 prior year.
 */
function twelveMonthsBefore(reference: Date): Date {
  const d = new Date(reference.getTime());
  d.setFullYear(d.getFullYear() - 1);
  return d;
}

function monthKey(d: Date): string {
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1;
  return `${year}-${month.toString().padStart(2, "0")}`;
}

/**
 * Build an ordered list of the 12 YYYY-MM keys ending at referenceDate
 * (inclusive). Used so months with zero spend are still counted in the stdev
 * computation — otherwise highly seasonal data would look smoother than it is.
 */
function buildMonthWindow(reference: Date): string[] {
  const keys: string[] = [];
  const anchor = new Date(
    Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), 1),
  );
  for (let i = 11; i >= 0; i -= 1) {
    const d = new Date(anchor.getTime());
    d.setUTCMonth(d.getUTCMonth() - i);
    keys.push(monthKey(d));
  }
  return keys;
}

export function analyzeCOGSpendPatterns(
  input: AnalyzeCOGSpendPatternsInput,
): SpendPatternAnalysis {
  const {
    vendorId,
    purchases,
    pricingFile,
    categoryTotalSpend12Mo = 0,
  } = input;

  // Reference date: explicit > max purchase date > now.
  let referenceDate: Date;
  if (input.referenceDate) {
    referenceDate = input.referenceDate;
  } else if (purchases.length > 0) {
    const maxMs = purchases.reduce(
      (acc, p) => Math.max(acc, p.transactionDate.getTime()),
      Number.NEGATIVE_INFINITY,
    );
    referenceDate = new Date(maxMs);
  } else {
    referenceDate = new Date();
  }

  const windowStart = twelveMonthsBefore(referenceDate);
  const inWindow = purchases.filter(
    (p) =>
      p.transactionDate.getTime() > windowStart.getTime() &&
      p.transactionDate.getTime() <= referenceDate.getTime(),
  );

  const totalSpend12Mo = inWindow.reduce((acc, p) => acc + p.extendedPrice, 0);

  // Monthly stdev (populational).
  const monthKeys = buildMonthWindow(referenceDate);
  const monthlyTotals = new Map<string, number>(monthKeys.map((k) => [k, 0]));
  for (const p of inWindow) {
    const key = monthKey(p.transactionDate);
    if (monthlyTotals.has(key)) {
      monthlyTotals.set(key, (monthlyTotals.get(key) ?? 0) + p.extendedPrice);
    }
  }
  const monthly = monthKeys.map((k) => monthlyTotals.get(k) ?? 0);
  const monthlyMean = totalSpend12Mo / 12;
  const variance =
    monthly.reduce((acc, m) => acc + (m - monthlyMean) ** 2, 0) / 12;
  const monthlyStdev = Math.sqrt(variance);
  const monthlyStdevPct =
    monthlyMean > 0 ? (monthlyStdev / monthlyMean) * 100 : 0;
  const seasonalityFlag = monthlyStdevPct > SEASONALITY_PCT_THRESHOLD;

  // Top-5 items by spend.
  type ItemAgg = { spend: number; description: string; count: number };
  const itemAgg = new Map<string, ItemAgg>();
  for (const p of inWindow) {
    const key = p.vendorItemNo ?? "";
    if (!key) continue;
    const existing = itemAgg.get(key);
    if (existing) {
      existing.spend += p.extendedPrice;
      existing.count += 1;
      if (!existing.description && p.productDescription) {
        existing.description = p.productDescription;
      }
    } else {
      itemAgg.set(key, {
        spend: p.extendedPrice,
        description: p.productDescription ?? key,
        count: 1,
      });
    }
  }
  const top5ItemsBySpend = Array.from(itemAgg.entries())
    .map(([vendorItemNo, agg]) => ({
      vendorItemNo,
      description: agg.description || vendorItemNo,
      spend: agg.spend,
    }))
    .sort((a, b) => b.spend - a.spend)
    .slice(0, TOP_ITEM_COUNT);

  // Price drift — for each pricing-file row whose item appears in purchases,
  // compute avg purchase unit price ≈ totalSpend / count (no qty available).
  let driftSum = 0;
  let driftMatches = 0;
  for (const row of pricingFile) {
    const agg = itemAgg.get(row.vendorItemNo);
    if (!agg || agg.count === 0 || row.contractPrice <= 0) continue;
    const avgPurchasePrice = agg.spend / agg.count;
    const drift =
      ((avgPurchasePrice - row.contractPrice) / row.contractPrice) * 100;
    driftSum += drift;
    driftMatches += 1;
  }
  const priceDriftVsPricingFile =
    driftMatches > 0 ? driftSum / driftMatches : 0;

  const categoryMarketShare =
    categoryTotalSpend12Mo > 0 ? totalSpend12Mo / categoryTotalSpend12Mo : 0;
  const tieInRiskFlag = categoryMarketShare > TIE_IN_SHARE_THRESHOLD;

  return {
    vendorId,
    totalSpend12Mo,
    monthlyStdevPct,
    seasonalityFlag,
    top5ItemsBySpend,
    priceDriftVsPricingFile,
    categoryMarketShare,
    tieInRiskFlag,
  };
}
