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
 */
export function matchVendorByAlias(
  importName: string,
  vendors: { id: string; name: string; displayName?: string | null }[]
): string | null {
  const canonical = resolveVendorAlias(importName)
  if (!canonical) return null

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

  return null
}
