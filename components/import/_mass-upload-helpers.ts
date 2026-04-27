// Pure utility helpers for MassUpload — no JSX, no component state.

/** Generate a short random ID string (7 chars, base-36). */
export function generateId(): string {
  return Math.random().toString(36).substring(2, 9)
}

/**
 * Compute a rough character-overlap similarity score between two strings.
 * Returns a value in [0, 1] where 1 means identical (after normalisation).
 */
export function calculateSimilarity(str1: string, str2: string): number {
  const s1 = str1.toLowerCase().replace(/[^a-z0-9]/g, "")
  const s2 = str2.toLowerCase().replace(/[^a-z0-9]/g, "")
  if (s1 === s2) return 1
  const longer = s1.length > s2.length ? s1 : s2
  const shorter = s1.length > s2.length ? s2 : s1
  if (longer.length === 0) return 1
  let matches = 0
  for (let i = 0; i < shorter.length; i++) {
    if (longer.includes(shorter[i])) matches++
  }
  return matches / longer.length
}
