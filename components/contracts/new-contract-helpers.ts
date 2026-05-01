import { similarityRatio, normalizeVendorName } from "@/lib/vendors/similarity"

export interface VendorRow {
  id: string
  name: string
  displayName: string | null
}

/**
 * Charles 2026-04-30 bug doc: "the AI does not pick up each one it
 * does not know based on the PDF which to choose" — when a PDF
 * mentions multiple vendor strings ("MAKO Surgical Corp", "Stryker
 * Sales LLC", "Stryker Mako"), the AI returns one of them and the
 * old helper just returned whichever substring-matched FIRST in the
 * vendor list. With "Stryker Endoscopy", "Stryker Spine", "Stryker,
 * Inc" all in the list, the wrong one wins.
 *
 * Score each candidate via similarityRatio against both name and
 * displayName, prefer EXACT / PREFIX / containment in that order,
 * fall back to similarity ≥ 0.7. Returns null when nothing crosses
 * the threshold so the caller can prompt to create a new vendor
 * instead of mismatching.
 */
export function matchOrCreateVendorId(
  vendorName: string,
  vendors: VendorRow[],
): string | null {
  const fragment = vendorName.trim().toLowerCase()
  if (!fragment) return null

  const fragmentNorm = normalizeVendorName(fragment)

  // 1. Exact match (case-insensitive) on name OR displayName.
  for (const v of vendors) {
    const a = v.name.toLowerCase()
    const b = (v.displayName ?? "").toLowerCase()
    if (a === fragment || (b && b === fragment)) return v.id
  }

  // 2. Normalized exact match (strip Inc/LLC/Co/punct via similarity helper).
  for (const v of vendors) {
    const a = normalizeVendorName(v.name)
    const b = v.displayName ? normalizeVendorName(v.displayName) : ""
    if (a === fragmentNorm || (b && b === fragmentNorm)) return v.id
  }

  // 3. Score-based fuzzy match. Compute the highest similarity each
  //    vendor offers (best of name vs displayName) and pick the
  //    overall winner if it crosses the threshold. Containment also
  //    contributes a bonus so "Stryker" in vendor list matches
  //    AI's "Stryker Mako" even when normalized similarity is mid.
  const SIM_THRESHOLD = 0.7
  let best: { id: string; score: number } | null = null
  for (const v of vendors) {
    const aRaw = v.name.toLowerCase()
    const bRaw = (v.displayName ?? "").toLowerCase()
    const aNorm = normalizeVendorName(v.name)
    const bNorm = v.displayName ? normalizeVendorName(v.displayName) : ""
    const containment =
      aRaw.includes(fragment) ||
      fragment.includes(aRaw) ||
      (bRaw && (bRaw.includes(fragment) || fragment.includes(bRaw)))
        ? 0.2
        : 0
    const sim = Math.max(
      similarityRatio(fragmentNorm, aNorm),
      bNorm ? similarityRatio(fragmentNorm, bNorm) : 0,
    )
    const score = Math.min(1, sim + containment)
    if (score > (best?.score ?? 0)) {
      best = { id: v.id, score }
    }
  }
  if (best && best.score >= SIM_THRESHOLD) return best.id
  return null
}
