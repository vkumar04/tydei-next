"use client"

import { useEffect, useRef, useState } from "react"
import type { Dispatch, SetStateAction } from "react"

import { getFacilityActualsForVendor } from "@/lib/actions/vendor-prospective"

/** The state the sync writes, threaded in as a bundle so the effect body
 *  below stays exactly the one that lived in DealScorerSection. The setters
 *  are stable; `backfillFromReference` is the parent's per-render closure —
 *  captured (as before) from the render the effect fires in. */
export interface FacilityActualsSyncTargets {
  setCurrentPriceBySku: Dispatch<SetStateAction<Map<string, number>>>
  setPriceLoadedCount: Dispatch<SetStateAction<number>>
  setUsageVolumeBySku: Dispatch<SetStateAction<Map<string, number>>>
  setUsageLoadedCount: Dispatch<SetStateAction<number>>
  backfillFromReference: (ref: {
    volume?: Map<string, number>
    price?: Map<string, number>
  }) => void
  setCurrentShare: Dispatch<SetStateAction<string>>
  setCategorySpends: Dispatch<
    SetStateAction<{ _uid: string; category: string; spend: string }[]>
  >
}

// Wave-2 E: two-way sync auto-pull. When a facility is selected and the
// vendor has an accepted TWO-WAY connection with it, pull the facility's
// trailing-12mo actuals for this vendor and use them as the reference —
// fill the price/volume maps ONLY while they are still empty (uploads and
// proposal data always win), and seed Current share / Estimated spend only
// while blank. One-shot per facility (ref-guarded like appliedProposalRef);
// waits for the benchmark list (the construct source) so the SKU set is
// complete. One-way / no connection keeps manual mode + shows the badge.
export function useFacilityActualsSync(
  facilityId: string,
  benchmarks: { itemNumber: string }[] | undefined,
  targets: FacilityActualsSyncTargets,
): "two_way" | "one_way" | null {
  const {
    setCurrentPriceBySku,
    setPriceLoadedCount,
    setUsageVolumeBySku,
    setUsageLoadedCount,
    backfillFromReference,
    setCurrentShare,
    setCategorySpends,
  } = targets
  const appliedFacilityActualsRef = useRef<string | null>(null)
  const [actualsSyncMode, setActualsSyncMode] = useState<
    "two_way" | "one_way" | null
  >(null)
  useEffect(() => {
    if (!facilityId || benchmarks === undefined) return
    if (appliedFacilityActualsRef.current === facilityId) return
    appliedFacilityActualsRef.current = facilityId
    setActualsSyncMode(null)
    void getFacilityActualsForVendor(
      facilityId,
      benchmarks.map((b) => b.itemNumber),
    )
      .then((res) => {
        setActualsSyncMode(res.mode)
        if (res.mode !== "two_way") return
        const priceMap = new Map<string, number>()
        const volMap = new Map<string, number>()
        for (const it of res.items) {
          if (it.avgUnitPrice > 0) priceMap.set(it.sku, it.avgUnitPrice)
          if (it.annualQty > 0) volMap.set(it.sku, it.annualQty)
        }
        if (priceMap.size > 0) {
          setCurrentPriceBySku((prev) => (prev.size > 0 ? prev : priceMap))
          setPriceLoadedCount((prev) => (prev > 0 ? prev : priceMap.size))
        }
        if (volMap.size > 0) {
          setUsageVolumeBySku((prev) => (prev.size > 0 ? prev : volMap))
          setUsageLoadedCount((prev) => (prev > 0 ? prev : volMap.size))
        }
        // Blank-field backfill on already-picked constructs (never clobbers
        // an entered Volume / Current).
        backfillFromReference({ volume: volMap, price: priceMap })
        const share = res.currentSharePct
        if (share != null) {
          setCurrentShare((prev) => (prev ? prev : String(share)))
        }
        const spend = res.categorySpend
        if (spend != null && spend > 0) {
          setCategorySpends((prev) =>
            prev.length === 1 && !prev[0]!.spend
              ? [{ ...prev[0]!, spend: String(Math.round(spend)) }]
              : prev,
          )
        }
      })
      .catch(() => {
        /* non-fatal: stay in manual mode, no badge */
      })
  }, [facilityId, benchmarks])
  return actualsSyncMode
}
