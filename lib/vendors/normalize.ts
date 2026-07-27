/**
 * Canonical vendor-name key.
 *
 * Charles 2026-07-27 asked the question this module exists to answer: "In
 * settings on the vendor side I have a company name, example Stryker. How does
 * it know on the facility side what contract to pull in when multiple names are
 * used?" The facility-side join is by `vendorId` FK and is exact — so the whole
 * answer lives in whether ingestion put the RIGHT id on the row. Ingestion
 * resolves a raw name string, and the real spellings ("STRYKER SALES CORP",
 * "Howmedica Osteonics", "MAKO Surgical Corp", "Stryker Flex Financial") were
 * missing the hardcoded alias list and silently minting duplicate Vendor rows,
 * each with its own spend silo.
 *
 * `vendorNameKey` is the key a VendorAlias is stored and looked up under. It is
 * deliberately AGGRESSIVE about formatting noise (case, punctuation, corporate
 * suffixes, whitespace) and deliberately EXACT about everything else — it must
 * never merge two genuinely different companies. Under-matching loses spend
 * from a contract; over-matching attributes one company's spend to another's
 * contract and inflates rebate accrual, which is a financial error rather than
 * a reporting gap. There is no fuzziness here on purpose: fuzzy matching stays
 * where it already lives, behind the 0.7 Levenshtein threshold in
 * `lib/vendor-aliases.ts`, as the LAST resort rather than the alias mechanism.
 *
 * NOTE: three other `normalizeVendorName` implementations exist
 * (lib/vendors/similarity.ts, lib/utils/levenshtein.ts, lib/vendor-aliases.ts)
 * and they disagree on suffix lists and punctuation handling. They are the
 * inputs to the legacy FUZZY passes and are intentionally left alone here —
 * rewiring them would silently change existing match outcomes across every
 * historical import. Unifying them is tracked separately; this module is the
 * canonical key for the exact-alias pass only.
 */

/**
 * Corporate/legal suffix tokens stripped from the end of a name. Order does not
 * matter — stripping loops until the name stops changing, so "Acme Corp Inc"
 * collapses across passes.
 */
const CORPORATE_SUFFIX_TOKENS = [
  "incorporated",
  "corporation",
  "corp",
  "inc",
  "llc",
  "l l c",
  "ltd",
  "limited",
  "lp",
  "llp",
  "plc",
  "gmbh",
  "sa",
  "nv",
  "bv",
  "ag",
  "co",
  "company",
  "holdings",
  "holding",
  "usa",
  "us",
]

/**
 * Normalize a vendor name to its comparison key.
 *
 * Lowercases, replaces punctuation with spaces, collapses whitespace, then
 * repeatedly strips trailing corporate suffix tokens. Returns "" for a name
 * that is nothing but suffixes/punctuation — callers must treat "" as
 * "no usable key" and never match on it.
 */
export function vendorNameKey(name: string): string {
  let out = (name ?? "").toLowerCase()

  // Punctuation → space, so "Stryker, Inc." and "Stryker Inc" converge and
  // suffix tokens separate cleanly.
  out = out.replace(/[^a-z0-9]+/g, " ")

  let changed = true
  while (changed) {
    changed = false
    out = out.trim().replace(/\s+/g, " ")
    for (const suffix of CORPORATE_SUFFIX_TOKENS) {
      const re = new RegExp(`(^|\\s)${suffix}$`)
      if (re.test(out)) {
        out = out.replace(re, "").trim()
        changed = true
      }
    }
  }

  return out.replace(/\s+/g, " ").trim()
}

/** True when a name normalizes to something usable as an alias key. */
export function isUsableVendorNameKey(name: string): boolean {
  return vendorNameKey(name).length > 0
}
