// Charles audit round-10 BLOCKER: removed "use server" — internal
// helper consumed by recomputeAccrualForContract.
//
// Decomposition 2026-08-05: the implementation now lives in the
// volume-* sibling modules; this file is a pure facade so every import
// site — the DYNAMIC import string in
// `lib/actions/contracts/recompute-accrual.ts`, the static import in
// `lib/actions/contracts/accrual.ts`, the pinned test files, and
// `scripts/verify-0613.ts` — keeps resolving
// "@/lib/contracts/recompute/volume" unchanged. Do NOT add
// "use server" here or in any sibling module: the sync helper exports
// would be flagged by use-server-async-export-scanner.test.ts and
// registered as server actions.
//
//   volume-shared.ts     — VolumeRebateTermLike + window helpers
//                          (widthMonths, addMonthsUTC, endOfDay,
//                          termVendorIds)
//   volume-tier-math.ts  — F2 pure tier helpers, shared with the
//                          accrual timeline (canonical — never fork)
//   volume-cpt-writer.ts — recomputeVolumeAccrualForTerm: CPT path +
//                          dispatcher to the two fallback writers
//   volume-cog-writer.ts — COG-records fallback writer (Bug #17)
//   volume-po-writer.ts  — purchase_order fallback writer (2026-05-20)

export type { NormalizedVolumeTier } from "@/lib/contracts/recompute/volume-tier-math"
export {
  computeVolumeTierRebate,
  currentOpenVolumeWindow,
  normalizeVolumeTiers,
  selectAchievedVolumeTier,
} from "@/lib/contracts/recompute/volume-tier-math"
export { recomputeVolumeAccrualForTerm } from "@/lib/contracts/recompute/volume-cpt-writer"
