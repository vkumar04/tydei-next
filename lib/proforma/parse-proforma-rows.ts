/**
 * Parse an uploaded Steady State Proforma into `ProformaLineItems`.
 *
 * Charles 2026-08-10: "need a place to upload the P/L raw numbers" — the
 * Dividend/DCF tab previously required hand-typing 22 line items, which is
 * both slow and error-prone when the facility already has the statement in a
 * spreadsheet.
 *
 * A proforma is a LABEL/VALUE sheet, not a header-per-column table: one row
 * per P&L line, the label in one column and the amount in another. So this
 * matches on the LABEL rather than a header row, using an alias list per
 * field (the same tolerance the pricing/COG header mappers apply to columns).
 * Amounts route through the canonical `parseMoney`, which already handles
 * "$267,441,411" and accounting-negative "(235,348,442)".
 */

import { parseMoney } from "@/lib/actions/imports/shared"
import type { ProformaLineItems } from "@/lib/financial-analysis/proforma-pnl"

/** Canonical form for label matching: lowercase alphanumerics only. */
function canonicalizeLabel(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]/g, "")
}

/**
 * Aliases per line item, most specific first. Matching is exact-on-canonical
 * first, then "label contains alias" — so "Revenue - standard billing rate"
 * and "Standard Billing Revenue" both land on the same field.
 *
 * Ordering matters for the contains pass: `contractualAdjustment` must be
 * tried before `standardBillingRevenue`, or "revenue contractual adjustment"
 * would match the bare "revenue" alias first.
 */
const FIELD_ALIASES: [keyof ProformaLineItems, string[]][] = [
  [
    "contractualAdjustment",
    [
      "revenuecontractualadjustment",
      "contractualadjustment",
      "contractualallowance",
      "payerdiscount",
      "revenuedeductions",
    ],
  ],
  [
    "standardBillingRevenue",
    [
      "revenuestandardbillingrate",
      "standardbillingrevenue",
      "grosscharges",
      "grossrevenue",
      "standardbilling",
      "totalcharges",
    ],
  ],
  ["salaryBenefits", ["salaryandbenefits", "salariesandbenefits", "salarybenefits", "payroll"]],
  [
    "medicalSupplies",
    [
      "medicalsuppliesandservices",
      "medicalsupplies",
      "supplyexpense",
      "medicalsupply",
      "implantsandsupplies",
    ],
  ],
  ["smallEquipment", ["smallequipmentpurchases", "smallequipment", "minorequipment"]],
  ["officeExpenses", ["officeexpenses", "officeexpense", "officesupplies"]],
  ["legal", ["legal", "legalfees", "legalandprofessional"]],
  ["computerServices", ["computerservices", "computerservice", "itservices"]],
  ["managementFees", ["managementfees", "managementfee", "mgmtfees"]],
  ["billingCollection", ["billingandcollection", "billingcollection", "billingfees"]],
  [
    "otherOutsideServices",
    ["otheroutsideservices", "outsideservices", "otheroutsideservice"],
  ],
  ["insurance", ["insurance", "insuranceexpense"]],
  ["administrative", ["administrativeexpenses", "administrative", "adminexpenses", "gaexpenses"]],
  [
    "rentTiUtilities",
    [
      "renttiamortizationutilities",
      "renttiutilities",
      "rentandutilities",
      "rentutilities",
      "rent",
    ],
  ],
  ["otherFacility", ["otherfacilityexpenses", "otherfacility", "facilityexpenses"]],
  ["repairsMaintenance", ["repairsmaintenance", "repairsandmaintenance", "maintenance"]],
  ["propTax", ["propertytax", "proptax", "realestatetax"]],
  ["stateTaxes", ["statetaxes", "statetax"]],
  ["softwareMaintenance", ["softwaremaintenance", "software"]],
  [
    "equipRentInterestOther",
    [
      "equiprentinterestother",
      "equipmentrentinterestother",
      "equipmentrent",
      "interestexpense",
    ],
  ],
  ["caseVolume", ["casevolume", "annualcases", "totalcases", "casecount", "cases", "volume"]],
]

export interface ParsedProforma {
  lineItems: ProformaLineItems
  /** Fields a label was found for — the rest keep their default. */
  matchedFields: (keyof ProformaLineItems)[]
  /** Labels present in the file that matched nothing, for user feedback. */
  unmatchedLabels: string[]
}

/** Every field zero — an uploaded statement supplies what it has. */
const EMPTY_LINE_ITEMS: ProformaLineItems = {
  standardBillingRevenue: 0,
  contractualAdjustment: 0,
  salaryBenefits: 0,
  medicalSupplies: 0,
  smallEquipment: 0,
  officeExpenses: 0,
  legal: 0,
  computerServices: 0,
  managementFees: 0,
  billingCollection: 0,
  otherOutsideServices: 0,
  insurance: 0,
  administrative: 0,
  rentTiUtilities: 0,
  otherFacility: 0,
  repairsMaintenance: 0,
  propTax: 0,
  stateTaxes: 0,
  softwareMaintenance: 0,
  equipRentInterestOther: 0,
  caseVolume: 0,
}

/**
 * Section headers and computed totals — never line items. Matched EXACTLY on
 * the canonical form, never by prefix: a `startsWith("total")` rule also ate
 * "Total charges" and "Total cases", which are real line items and are this
 * parser's own aliases for standardBillingRevenue and caseVolume.
 */
const IGNORED_LABELS = new Set([
  "totalrevenue",
  "totalrevenues",
  "totalnetrevenue",
  "totalvariableexpense",
  "totalvariableexpenses",
  "totalfixedexpense",
  "totalfixedexpenses",
  "totalexpense",
  "totalexpenses",
  "totaloperatingexpenses",
  "subtotal",
  "netoperatingincome",
  "operatingincome",
  "noi",
  "ebitda",
  "grossprofit",
  "netincome",
  "netprofit",
  "variableexpenses",
  "variableexpense",
  "fixedexpenses",
  "fixedexpense",
  "revenue",
  "revenues",
  "expenses",
  "expense",
])

function isIgnoredLabel(canonical: string): boolean {
  return canonical === "" || IGNORED_LABELS.has(canonical)
}

/**
 * Fields whose amount is stored POSITIVE even when the statement writes it as
 * a negative or parenthesized figure. Every expense line and the contractual
 * adjustment are subtracted downstream, so a "(2,987,260)" salary line must
 * not flip the sign and inflate NOI.
 *
 * `standardBillingRevenue` is deliberately absent — it is the one line that is
 * genuinely additive, and a negative there is a real (if odd) input.
 */
const STORED_POSITIVE = new Set<keyof ProformaLineItems>([
  "contractualAdjustment",
  "salaryBenefits",
  "medicalSupplies",
  "smallEquipment",
  "officeExpenses",
  "legal",
  "computerServices",
  "managementFees",
  "billingCollection",
  "otherOutsideServices",
  "insurance",
  "administrative",
  "rentTiUtilities",
  "otherFacility",
  "repairsMaintenance",
  "propTax",
  "stateTaxes",
  "softwareMaintenance",
  "equipRentInterestOther",
  "caseVolume",
])

function matchField(canonical: string): keyof ProformaLineItems | null {
  for (const [field, aliases] of FIELD_ALIASES) {
    if (aliases.includes(canonical)) return field
  }
  // Contains pass: take the LONGEST matching alias across all fields, not the
  // first in array order. Short aliases ("rent", "legal") otherwise capture
  // labels that a longer, more specific alias should own — "Equipment rent /
  // interest / other" was landing on rentTiUtilities via "rent", and
  // first-occurrence-wins then discarded the real line.
  let best: { field: keyof ProformaLineItems; len: number } | null = null
  for (const [field, aliases] of FIELD_ALIASES) {
    for (const a of aliases) {
      if (canonical.includes(a) && (best === null || a.length > best.len)) {
        best = { field, len: a.length }
      }
    }
  }
  return best?.field ?? null
}

/**
 * Pull the amount out of a row: the first cell after the label column that
 * parses to a non-zero number. Real statements carry trailing per-case or
 * %-of-revenue columns, so "first numeric wins" beats "last column".
 */
function amountFromRow(cells: string[], labelIndex: number): number | null {
  for (let i = labelIndex + 1; i < cells.length; i++) {
    const raw = (cells[i] ?? "").trim()
    if (raw === "") continue
    // Skip ratio columns. Real statements carry "% of revenue" and per-case
    // columns alongside the dollars, and taking the first numeric would read
    // "35.5%" as $35.50 — three orders of magnitude wrong, silently.
    if (raw.includes("%")) continue
    // A cell that is not a number at all (a footnote, "n/a", a units label)
    // is not an amount — parseMoney would coerce it to 0 and we would store
    // a fabricated zero.
    if (!/\d/.test(raw)) continue
    const n = parseMoney(raw)
    if (!Number.isFinite(n)) continue
    if (n !== 0) return n
    // An explicit zero is a real value, not a blank.
    if (/^\(?[$-]?\s*0([.,]0+)?\s*\)?$/.test(raw)) return 0
  }
  return null
}

/**
 * Parse a proforma from a raw cell matrix (row-major). Works for both an
 * .xlsx matrix and a CSV split into cells, since a proforma has no reliable
 * header row to key on.
 */
export function parseProformaMatrix(matrix: string[][]): ParsedProforma {
  const lineItems: ProformaLineItems = { ...EMPTY_LINE_ITEMS }
  const matched = new Set<keyof ProformaLineItems>()
  const unmatchedLabels: string[] = []

  for (const row of matrix) {
    if (!row || row.length === 0) continue
    // The label is the first non-empty, non-numeric cell.
    let labelIndex = -1
    for (let i = 0; i < row.length; i++) {
      const cell = (row[i] ?? "").trim()
      if (cell === "") continue
      if (/^[($]?[\d,.\s)%-]+$/.test(cell)) continue // purely numeric
      labelIndex = i
      break
    }
    if (labelIndex === -1) continue

    const label = (row[labelIndex] ?? "").trim()
    const canonical = canonicalizeLabel(label)
    if (isIgnoredLabel(canonical)) continue

    const field = matchField(canonical)
    if (!field) {
      if (amountFromRow(row, labelIndex) !== null) unmatchedLabels.push(label)
      continue
    }
    // First occurrence wins: statements often repeat a label in a summary
    // block further down, and the detail line is the one we want.
    if (matched.has(field)) continue

    const amount = amountFromRow(row, labelIndex)
    if (amount === null) continue

    lineItems[field] = STORED_POSITIVE.has(field) ? Math.abs(amount) : amount
    matched.add(field)
  }

  return {
    lineItems,
    matchedFields: [...matched],
    unmatchedLabels,
  }
}

// NOTE: there is deliberately no records→matrix helper here. Rebuilding cell
// positions from header-KEYED records is unsound for a label/value sheet —
// duplicate or blank header names collapse (last column wins) and position is
// then unrecoverable, silently swapping the amount column. CSV callers must
// use `parseCsvTextToMatrixBounded`, which stays positional throughout.
