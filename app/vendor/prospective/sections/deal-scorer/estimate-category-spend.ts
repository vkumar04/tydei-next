import { canonicalizeCategoryName } from "@/lib/contracts/category-canonical"
import { normalizeSku } from "@/lib/contracts/normalize-sku"

/** The benchmark fields the estimate reads (a structural subset of
 *  VendorBenchmarkRow). */
export interface CategorySpendBenchmark {
  category: string
  itemNumber: string
}

/** The loaded reference-file state the estimate is derived from — passed
 *  explicitly so this stays a pure function of its inputs. */
export interface CategorySpendReference {
  benchmarks: CategorySpendBenchmark[] | undefined
  currentPriceBySku: Map<string, number>
  usageVolumeBySku: Map<string, number>
  /** Current revenue straight from the usage + price files: Σ(current price ×
   *  volume) across every item. */
  usageCurrentRevenue: number
  /** Current share % exactly as typed in the form ("" when blank). */
  currentShare: string
}

// Starting-point spend for a category picked on a "Facility estimated annual
// category spend" row, derived from the loaded reference files: Σ(current
// price × usage volume) over the SKUs whose BENCHMARK category matches
// (canonical compare — never raw ===), divided by Current share % when one
// is entered so it approximates the facility's TOTAL category spend. Blank
// category (= all) sums every SKU present in both files. The user can edit
// it — it only seeds a BLANK row ("system should take initial spend from
// those files", bugs.rtfd 2026-07-07).
export function estimateCategorySpendFromFiles(
  category: string,
  ref: CategorySpendReference,
): number {
  const {
    benchmarks,
    currentPriceBySku,
    usageVolumeBySku,
    usageCurrentRevenue,
    currentShare,
  } = ref
  let revenue = 0
  if (category) {
    const wanted = canonicalizeCategoryName(category)
    for (const b of benchmarks ?? []) {
      if (canonicalizeCategoryName(b.category) !== wanted) continue
      const sku = normalizeSku(b.itemNumber)
      const price = currentPriceBySku.get(sku)
      const vol = usageVolumeBySku.get(sku)
      if (price != null && vol != null) revenue += price * vol
    }
  } else {
    revenue = usageCurrentRevenue
  }
  if (revenue <= 0) return 0
  const sharePct = Number(currentShare)
  return sharePct > 0 && sharePct <= 100
    ? revenue / (sharePct / 100)
    : revenue
}
