/**
 * Map of canonical vendor names to known aliases.
 * Used during COG import to auto-match vendor name variations.
 */
export const VENDOR_ALIASES: Record<string, string[]> = {
  Stryker: [
    "Stryker Corp",
    "Stryker Orthopaedics",
    "Stryker Medical",
    "Stryker Spine",
  ],
  "J&J": [
    "Johnson & Johnson",
    "Ethicon",
    "DePuy Synthes",
    "DePuy Synthes Companies",
    "DePuy",
  ],
  Medtronic: [
    "Medtronic Spine",
    "Medtronic Surgical",
  ],
  Arthrex: [
    "Arthrex Inc",
    "Arthrex, Inc.",
  ],
  "Smith & Nephew": [
    "Smith Nephew",
    "S&N",
  ],
  "Zimmer Biomet": [
    "Zimmer",
    "Biomet",
  ],
  Conmed: [
    "Conmed Corporation",
    "CONMED Corp",
  ],
  "Integra LifeSciences": [
    "Integra",
    "Integra Life Sciences",
  ],
  NuVasive: [
    "NuVasive Inc",
  ],
  Hologic: [
    "Hologic Inc",
  ],
  Medline: [
    "Medline Industries",
    "Medline Industries LP",
  ],
}

/**
 * Reverse lookup: given an import vendor name, find the canonical name.
 * Returns the canonical name if a match is found, otherwise null.
 * Matching is case-insensitive.
 */
export function resolveVendorAlias(importName: string): string | null {
  const lower = importName.toLowerCase().trim()

  for (const [canonical, aliases] of Object.entries(VENDOR_ALIASES)) {
    if (canonical.toLowerCase() === lower) return canonical
    for (const alias of aliases) {
      if (alias.toLowerCase() === lower) return canonical
    }
  }

  return null
}

/**
 * Given a list of system vendors and an import vendor name,
 * attempt to find a matching vendor ID via alias resolution.
 * Falls back to fuzzy matching if no exact alias match is found.
 */
export function matchVendorByAlias(
  importName: string,
  vendors: { id: string; name: string; displayName?: string | null }[]
): string | null {
  const canonical = resolveVendorAlias(importName)

  if (canonical) {
    // Find a vendor whose name or displayName matches the canonical name or any alias
    const allNames = [canonical, ...(VENDOR_ALIASES[canonical] ?? [])]
    const lowerNames = allNames.map((n) => n.toLowerCase())

    for (const vendor of vendors) {
      const vName = vendor.name.toLowerCase()
      const vDisplay = (vendor.displayName ?? "").toLowerCase()
      if (lowerNames.includes(vName) || lowerNames.includes(vDisplay)) {
        return vendor.id
      }
    }
  }

  // Fallback: fuzzy match against vendor list
  return fuzzyMatchVendor(importName, vendors)
}

// ─── Fuzzy Matching ────────────────────────────────────────────

const STRIP_SUFFIXES = /\b(inc|corp|corporation|llc|lp|ltd|co|company|limited|group|holdings)\b\.?/gi

/**
 * Normalize a vendor name for comparison: lowercase, strip common
 * corporate suffixes, collapse whitespace, trim.
 */
function normalizeVendorName(name: string): string {
  return name.toLowerCase().replace(STRIP_SUFFIXES, "").replace(/[.,]/g, "").replace(/\s+/g, " ").trim()
}

/**
 * Compute the Levenshtein distance between two strings.
 */
function levenshteinDistance(a: string, b: string): number {
  const m = a.length
  const n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))

  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      )
    }
  }

  return dp[m][n]
}

/**
 * Compute similarity as 1 - (distance / maxLength), clamped to [0, 1].
 */
function similarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length)
  if (maxLen === 0) return 1
  return 1 - levenshteinDistance(a, b) / maxLen
}

/**
 * Fuzzy-match an import vendor name against a list of system vendors
 * and all known aliases. Returns the best vendor ID if similarity > 0.7,
 * otherwise null.
 */
export function fuzzyMatchVendor(
  importName: string,
  vendors: { id: string; name: string; displayName?: string | null }[]
): string | null {
  const normalized = normalizeVendorName(importName)
  if (!normalized) return null

  // Build candidate list: vendor names/displayNames + all canonical/alias names
  let bestScore = 0
  let bestVendorId: string | null = null

  // Check against vendor records directly
  for (const vendor of vendors) {
    const names = [vendor.name, vendor.displayName ?? ""].filter(Boolean)
    for (const name of names) {
      const score = similarity(normalized, normalizeVendorName(name))
      if (score > bestScore) {
        bestScore = score
        bestVendorId = vendor.id
      }
    }
  }

  // Also check against known canonical names + aliases, then map to vendor
  for (const [canonical, aliases] of Object.entries(VENDOR_ALIASES)) {
    const allNames = [canonical, ...aliases]
    for (const alias of allNames) {
      const score = similarity(normalized, normalizeVendorName(alias))
      if (score > bestScore) {
        // Find matching vendor for this canonical name
        const lowerNames = allNames.map((n) => n.toLowerCase())
        for (const vendor of vendors) {
          const vName = vendor.name.toLowerCase()
          const vDisplay = (vendor.displayName ?? "").toLowerCase()
          if (lowerNames.includes(vName) || lowerNames.includes(vDisplay)) {
            bestScore = score
            bestVendorId = vendor.id
            break
          }
        }
      }
    }
  }

  return bestScore > 0.7 ? bestVendorId : null
}
