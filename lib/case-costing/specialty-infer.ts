/**
 * Case costing — CPT-prefix-based specialty inference.
 *
 * Reference: docs/superpowers/specs/2026-04-18-case-costing-rewrite.md §4.0
 * (and canonical case-costing doc).
 *
 * Pure function — takes a CPT code string, returns a specialty label
 * derived from the leading digits. Unknown prefixes return "Unknown".
 */

export type Specialty =
  | "Orthopedics"
  | "Spine"
  | "Cardiac"
  | "General"
  | "Unknown"

const CPT_PREFIX_RULES: Array<{ prefixes: string[]; specialty: Specialty }> = [
  // Ortho: 27xxx (lower-extremity surgery) + 29xxx (arthroscopy)
  { prefixes: ["27", "29"], specialty: "Orthopedics" },
  // Spine: 22xxx (spinal instrumentation) + 63xxx (spinal surgery)
  { prefixes: ["22", "63"], specialty: "Spine" },
  // Cardiac: 33xxx (cardiothoracic)
  { prefixes: ["33"], specialty: "Cardiac" },
  // General surgery: 43xxx (digestive) + 44xxx (intestinal)
  { prefixes: ["43", "44"], specialty: "General" },
]

/**
 * Map a CPT code to its specialty via leading-2-digit prefix rules.
 * Non-string / empty / unrecognized → "Unknown".
 */
export function inferSpecialty(cptCode: string | null | undefined): Specialty {
  if (!cptCode || typeof cptCode !== "string") return "Unknown"
  const trimmed = cptCode.trim()
  if (trimmed.length < 2) return "Unknown"
  const prefix = trimmed.slice(0, 2)
  for (const rule of CPT_PREFIX_RULES) {
    if (rule.prefixes.includes(prefix)) return rule.specialty
  }
  return "Unknown"
}

/**
 * Infer the dominant specialty for a surgeon from a list of their CPT codes.
 * Returns the specialty with the most occurrences; ties resolve to the first
 * non-Unknown rule in library order. All-Unknown input → "Unknown".
 */
export function inferDominantSpecialty(cptCodes: string[]): Specialty {
  if (cptCodes.length === 0) return "Unknown"
  const counts = new Map<Specialty, number>()
  for (const code of cptCodes) {
    const s = inferSpecialty(code)
    counts.set(s, (counts.get(s) ?? 0) + 1)
  }
  // Drop Unknown when there's any known count
  const hasKnown = Array.from(counts.entries()).some(
    ([s, c]) => s !== "Unknown" && c > 0,
  )
  const candidates = hasKnown
    ? Array.from(counts.entries()).filter(([s]) => s !== "Unknown")
    : Array.from(counts.entries())
  candidates.sort((a, b) => b[1] - a[1])
  return candidates[0]?.[0] ?? "Unknown"
}
