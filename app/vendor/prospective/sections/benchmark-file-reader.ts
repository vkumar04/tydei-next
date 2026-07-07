/**
 * Benchmark-file reader for the vendor Prospective → Benchmarks tab
 * ("Need to be able to add data for the benchmarks", Vick 2026-06-12).
 *
 * Takes the parsed `{ headers, rows }` shape produced by `readPricingRows`
 * (CSV client-side, XLSX via /api/parse-file) and maps each row to a
 * benchmark import item for `importVendorBenchmarks`.
 *
 * Column detection for SKU / description / category / price MUST go through
 * the canonical alias lists in `lib/utils/parse-pricing-file.ts` (invariants
 * table: "Pricing-file header detection") — NEVER inline a copy; the 2026-06-10
 * proposal analyzer's hand-rolled list missed "ReferenceNumber" and dropped
 * every row. Benchmark-only columns (percentiles, min/max, sample size, data
 * date) get their own lists below because no other surface reads them.
 */

import {
  ITEM_NUMBER_ALIASES,
  DESCRIPTION_ALIASES,
  UNIT_PRICE_ALIASES,
  CATEGORY_ALIASES,
} from "@/lib/utils/parse-pricing-file"
import {
  norm,
  overrideIndex,
  type ResolvedMapping,
  type UploadFieldSpec,
} from "@/components/shared/uploads/field-spec"
import type { VendorBenchmarkImportInput } from "@/lib/actions/benchmarks"

// Benchmark files often name the product-identifier column "Construct"
// (the implant configuration being priced) — a benchmark-specific term that
// does NOT belong in the global COG/pricing item-number aliases. Canonical
// aliases come FIRST so a real SKU/catalog column still wins; "construct" is
// the last-resort fallback so Charles's real benchmark file (headers:
// Construct, National ASP, Hard Floor, …) auto-detects without a manual
// column-map step (verified on prod 2026-07-06).
const BENCHMARK_ITEM_NUMBER_ALIASES = [
  ...ITEM_NUMBER_ALIASES,
  "construct",
  "constructs",
]

// ─── Benchmark-specific header aliases ───────────────────────────
// Specific benchmark aliases come FIRST so a file that carries both a
// "National Avg Price" column and a generic "Price" column maps the
// national average to the right field; the canonical UNIT_PRICE_ALIASES
// act as the fallback for plain price lists.
const NATIONAL_AVG_ALIASES = [
  "national_avg_price", "nationalavgprice", "nationalavg",
  "national_average", "nationalaverage", "national_average_price",
  "avg_price", "avgprice", "average_price", "averageprice",
  "benchmark_price", "benchmarkprice",
  // Charles's real benchmark file (2026-07-06) names the average "National
  // ASP" — average selling price, the industry term.
  "national_asp", "nationalasp", "asp", "avg_asp", "average_selling_price",
  ...UNIT_PRICE_ALIASES,
]

const P25_ALIASES = [
  "p25", "percentile25", "percentile_25",
  "25th_percentile", "25thpercentile", "pctl25", "pct25", "25th",
]

const P50_ALIASES = [
  "p50", "percentile50", "percentile_50",
  "50th_percentile", "50thpercentile", "median", "pctl50", "pct50", "50th",
]

const P75_ALIASES = [
  "p75", "percentile75", "percentile_75",
  "75th_percentile", "75thpercentile", "pctl75", "pct75", "75th",
]

const MIN_PRICE_ALIASES = [
  "min_price", "minprice", "min", "low", "low_price", "lowprice", "floor_price",
  // Charles's real file calls the bottom of the range "Hard Floor" — that
  // column silently dropped ("Bottom not coming over", bugs.rtfd 2026-07-07).
  "hard_floor", "hardfloor", "floor", "price_floor",
]

const MAX_PRICE_ALIASES = [
  "max_price", "maxprice", "max", "high", "high_price", "highprice", "ceiling_price",
  "hard_ceiling", "hardceiling", "ceiling", "price_ceiling",
]

const SAMPLE_SIZE_ALIASES = [
  "sample_size", "samplesize", "n", "samples",
  "sample_count", "samplecount", "observations",
]

const DATA_DATE_ALIASES = [
  "data_date", "datadate", "as_of", "asof", "as_of_date", "asofdate",
  "date", "effective_date", "effectivedate", "benchmark_date", "benchmarkdate",
]

// ─── Field specs for the shared <PricingFileDropzone> ─────────────
// (uploader improvements 1, 2026-06-13). The "at least one price-ish
// field" rule can't be a per-field `required` — it stays inside
// mapBenchmarkRows (droppedNoPrice), and the Benchmarks surface keys
// its confirm copy + import gate off that result.
export const BENCHMARK_UPLOAD_SPECS: UploadFieldSpec[] = [
  { key: "itemNumber", label: "Item number", aliases: BENCHMARK_ITEM_NUMBER_ALIASES, required: true, kind: "text" },
  { key: "description", label: "Description", aliases: DESCRIPTION_ALIASES, kind: "text" },
  { key: "category", label: "Category", aliases: CATEGORY_ALIASES, kind: "text" },
  { key: "nationalAvgPrice", label: "National average price", aliases: NATIONAL_AVG_ALIASES, kind: "number" },
  { key: "percentile25", label: "25th percentile price", aliases: P25_ALIASES, kind: "number" },
  { key: "percentile50", label: "Median price (P50)", aliases: P50_ALIASES, kind: "number" },
  { key: "percentile75", label: "75th percentile price", aliases: P75_ALIASES, kind: "number" },
  { key: "minPrice", label: "Minimum price", aliases: MIN_PRICE_ALIASES, kind: "number" },
  { key: "maxPrice", label: "Maximum price", aliases: MAX_PRICE_ALIASES, kind: "number" },
  { key: "sampleSize", label: "Sample size", aliases: SAMPLE_SIZE_ALIASES, kind: "number" },
  { key: "dataDate", label: "Data date", aliases: DATA_DATE_ALIASES, kind: "date" },
]

// ─── Resolve (same norm scheme as the canonical detector, via the
//     shared field-spec module) ─────────────────────────────────────
function findIndex(normHeaders: string[], aliases: string[]): number {
  for (const alias of aliases) {
    const idx = normHeaders.indexOf(norm(alias))
    if (idx >= 0) return idx
  }
  return -1
}

// Strip $/commas/whitespace; undefined when the cell isn't a number.
function parseNum(v: string): number | undefined {
  const cleaned = v.replace(/[^0-9.-]/g, "")
  if (!cleaned) return undefined
  const n = parseFloat(cleaned)
  return Number.isFinite(n) ? n : undefined
}

function parseDateISO(v: string): string | undefined {
  const trimmed = v.trim()
  if (!trimmed) return undefined
  const d = new Date(trimmed)
  if (Number.isNaN(d.getTime())) return undefined
  return d.toISOString().slice(0, 10)
}

export interface ParsedBenchmarkRows {
  items: VendorBenchmarkImportInput[]
  /** rows that had an item number but no price-ish field (dropped) */
  droppedNoPrice: number
  /** rows with a nationalAvgPrice — surfaced in the import confirm copy */
  withNationalAvg: number
}

/**
 * Map parsed `{ headers, rows }` to benchmark import items.
 *
 * Row rules: rows without an item number are dropped; a kept row must carry
 * at least ONE price-ish field (national avg, any percentile, min or max).
 */
export function mapBenchmarkRows(
  headers: string[],
  rows: Record<string, string>[],
  /**
   * From the shared <PricingFileDropzone> mapping dialog — when
   * provided, the user's columns FULLY replace auto-detection
   * (uploader improvements 1, 2026-06-13).
   */
  mappingOverride?: ResolvedMapping,
): ParsedBenchmarkRows {
  const normHeaders = headers.map(norm)

  const idx = (key: string, aliases: string[]): number =>
    mappingOverride
      ? overrideIndex(headers, mappingOverride, key)
      : findIndex(normHeaders, aliases)

  const idxItem = idx("itemNumber", BENCHMARK_ITEM_NUMBER_ALIASES)
  const idxDesc = idx("description", DESCRIPTION_ALIASES)
  const idxCat = idx("category", CATEGORY_ALIASES)
  const idxAvg = idx("nationalAvgPrice", NATIONAL_AVG_ALIASES)
  const idxP25 = idx("percentile25", P25_ALIASES)
  const idxP50 = idx("percentile50", P50_ALIASES)
  const idxP75 = idx("percentile75", P75_ALIASES)
  const idxMin = idx("minPrice", MIN_PRICE_ALIASES)
  const idxMax = idx("maxPrice", MAX_PRICE_ALIASES)
  const idxN = idx("sampleSize", SAMPLE_SIZE_ALIASES)
  const idxDate = idx("dataDate", DATA_DATE_ALIASES)

  const items: VendorBenchmarkImportInput[] = []
  let droppedNoPrice = 0
  let withNationalAvg = 0

  for (const row of rows) {
    const get = (idx: number) => (idx >= 0 ? (row[headers[idx]!] ?? "") : "")
    const vendorItemNo = get(idxItem).trim()
    if (!vendorItemNo) continue

    const nationalAvgPrice = parseNum(get(idxAvg))
    const percentile25 = parseNum(get(idxP25))
    const percentile50 = parseNum(get(idxP50))
    const percentile75 = parseNum(get(idxP75))
    const minPrice = parseNum(get(idxMin))
    const maxPrice = parseNum(get(idxMax))

    const hasPrice = [
      nationalAvgPrice, percentile25, percentile50,
      percentile75, minPrice, maxPrice,
    ].some((v) => v !== undefined)
    if (!hasPrice) {
      droppedNoPrice++
      continue
    }
    if (nationalAvgPrice !== undefined) withNationalAvg++

    const sampleRaw = parseNum(get(idxN))
    const description = get(idxDesc).trim()
    const category = get(idxCat).trim()

    items.push({
      vendorItemNo,
      description: description || undefined,
      category: category || undefined,
      nationalAvgPrice,
      percentile25,
      percentile50,
      percentile75,
      minPrice,
      maxPrice,
      sampleSize: sampleRaw !== undefined ? Math.round(sampleRaw) : undefined,
      dataDate: parseDateISO(get(idxDate)),
    })
  }

  return { items, droppedNoPrice, withNationalAvg }
}
