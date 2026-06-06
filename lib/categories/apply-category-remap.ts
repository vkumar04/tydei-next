/**
 * User-chosen raw→canonical category remap (Charles 2026-06-06).
 *
 * Pure helper — kept out of the `"use server"` pricing-import actions
 * (which may only export async functions) so it stays unit-testable.
 * During a pricing-file upload the user explicitly realigns each detected
 * category name to one of the system's canonical categories; this applies
 * that choice BEFORE the existing `resolveCategoryNamesBulk` /
 * `canonicalize` pass. The user's explicit pick wins; anything not in the
 * map falls through unchanged so canonicalization behaves exactly as before.
 */

/** Apply a user-chosen raw→canonical category remap. Returns the remapped
 *  category when the raw value (trimmed) is in the map, else the original. */
export function applyCategoryRemap(
  rawCategory: string | null | undefined,
  remap: Record<string, string>,
): string | null | undefined {
  if (rawCategory == null) return rawCategory
  const hit = remap[rawCategory.trim()]
  return hit !== undefined && hit !== "" ? hit : rawCategory
}
