/**
 * Public Medicare Ambulatory Surgical Center (ASC) payment rates by procedure
 * group — CMS ASC national average allowable for a representative primary
 * CPT/HCPCS per group, reflecting the CY2025 ASC fee schedule (+2.9% market-
 * basket update over CY2024).
 *
 * Facilities are reimbursed at a negotiated PERCENT OF MEDICARE (the Steady
 * State Proforma is modeled at 1.2× / 120%); effective reimbursement per case
 * = medicareRate × (percentOfMedicare / 100). `percentOfMedicare` is a WHOLE
 * percent (120, not 1.2) — same denomination as the %-of-Medicare band in
 * `managed-care-predictor.ts`, which owns *predicting* that percent; this
 * module owns the public base-rate DOLLARS it applies to.
 *
 * National averages — actuals vary by locality and payer contract, so every
 * rate is overridable in the UI. Packaged add-ons (navigation) carry $0
 * separate ASC payment; drug codes (J-codes) are ASP-based per-course.
 */
export interface MedicareAscRate {
  /** Procedure group name — matches payor volume procedure groups exactly. */
  group: string
  /**
   * Optional display name. The `group` stays the join key against payor
   * volume; this is what a user renamed the row to for readability.
   */
  label?: string
  /** Representative primary CPT/HCPCS code for the group. */
  code: string
  /** CMS ASC national average payment rate for that code, USD. */
  medicareRate: number
  /** Optional note (e.g. packaged add-on, ASP-based drug). */
  note?: string
}

/** Default facility reimbursement level vs. Medicare (Steady State = 1.2×). */
export const DEFAULT_PERCENT_OF_MEDICARE = 120

const RATES: MedicareAscRate[] = [
  { group: "Total Knee Replacement", code: "CPT 27447", medicareRate: 9450 },
  { group: "Total Hip Replacement", code: "CPT 27130", medicareRate: 9641 },
  { group: "Partial Knee Replacement", code: "CPT 27446", medicareRate: 8450 },
  { group: "Knee Revision", code: "CPT 27487", medicareRate: 11200 },
  { group: "ROTATOR CUFF REPAIR", code: "CPT 29827", medicareRate: 5650 },
  { group: "Shoulder", code: "CPT 29826", medicareRate: 3950 },
  { group: "Shoulder Replacement", code: "CPT 23472", medicareRate: 11800 },
  {
    group: "Total/Reverse Shoulder Replacement",
    code: "CPT 23472",
    medicareRate: 11800,
  },
  { group: "ACL/PCL Reconstruction", code: "CPT 29888", medicareRate: 4950 },
  { group: "Knee Meniscus Repair", code: "CPT 29882", medicareRate: 3450 },
  { group: "AC Joint Repair", code: "CPT 29824", medicareRate: 3850 },
  { group: "Ankle Fracture", code: "CPT 27792", medicareRate: 5250 },
  { group: "Hand", code: "CPT 26720", medicareRate: 2350 },
  { group: "Wrist", code: "CPT 25607", medicareRate: 3450 },
  { group: "Hand Wrist Recon", code: "CPT 25447", medicareRate: 3650 },
  { group: "Repair of Forearm/Wrist", code: "CPT 25545", medicareRate: 3550 },
  { group: "Repair of Elbow", code: "CPT 24586", medicareRate: 4650 },
  {
    group: "Tendon/Ligament Repair, Hand/Fingers",
    code: "CPT 26356",
    medicareRate: 2850,
  },
  { group: "Internal Fixation - Arm", code: "CPT 24515", medicareRate: 4850 },
  { group: "Internal Fixation - Hand", code: "CPT 26608", medicareRate: 3050 },
  {
    group: "Internal Fixation - Tibia/Fibula",
    code: "CPT 27759",
    medicareRate: 6250,
  },
  {
    group: "Internal Fixation - Shoulder/Proximal Humerus",
    code: "CPT 23615",
    medicareRate: 5450,
  },
  {
    group: "Internal Fixation - Hip/Upper Femur",
    code: "CPT 27245",
    medicareRate: 7850,
  },
  {
    group: "Mini Frag",
    code: "Small-fragment fixation",
    medicareRate: 3200,
    note: "Small-fragment internal-fixation set — modeled as adjunct fixation.",
  },
  {
    group: "Computer Assisted Nav",
    code: "CPT 20985",
    medicareRate: 0,
    note: "Surgical navigation is a packaged add-on — $0 separate ASC payment.",
  },
  {
    group: "Pre-op Planning CT",
    code: "CPT 76497",
    medicareRate: 250,
    note: "Pre-operative planning imaging — modest separate allowable.",
  },
  {
    group: "Orthovisc (DePuy)",
    code: "HCPCS J7324",
    medicareRate: 900,
    note: "Viscosupplementation drug — ASP-based (ASP + 6%), per course.",
  },
  {
    group: "Synvisc/ Synvisc One (Sanofi)",
    code: "HCPCS J7325",
    medicareRate: 950,
    note: "Viscosupplementation drug — ASP-based (ASP + 6%), per course.",
  },
  {
    group: "Series RT",
    code: "Viscosupplementation series",
    medicareRate: 850,
    note: "Injection-series therapy — ASP-based per course.",
  },
  { group: "Other Sports Med", code: "CPT 29999", medicareRate: 3500 },
]

// Group names arrive from uploaded payor files with arbitrary casing and
// stray whitespace — the project rule (category names are never compared
// raw) applies here too, or "Rotator Cuff Repair" would silently miss the
// "ROTATOR CUFF REPAIR" table entry and understate the reimbursement.
function normalizeGroupName(group: string): string {
  return group.trim().toLowerCase()
}

const byGroup = new Map(RATES.map((r) => [normalizeGroupName(r.group), r]))

export function getMedicareAscRate(group: string): MedicareAscRate | undefined {
  return byGroup.get(normalizeGroupName(group))
}

export function getAllMedicareAscRates(): MedicareAscRate[] {
  return RATES
}

/**
 * Where a resolved rate came from. Ordered by authority — the UI shows this
 * so a rep knows which figures are trustworthy before quoting them.
 *
 * `estimate` is the honest label for the built-in table: only the total-knee
 * and total-hip anchors are verified CMS figures, the rest are reasonable
 * placeholders. Charles 2026-08-11: "need to be able to adjust these".
 */
export type MedicareRateSource = "authoritative" | "uploaded" | "estimate"

export interface ResolvedMedicareRate extends MedicareAscRate {
  source: MedicareRateSource
}

/** A per-group authoritative override, entered by hand. */
export interface MedicareRateOverrideInput {
  group: string
  label?: string
  code: string
  medicareRate: number
  note?: string
  /**
   * Whether a human actually entered this rate. A label/note-only edit stores
   * an override for presentation but leaves the NUMBER unverified, so the row
   * keeps its underlying source. Defaults true for older rows, which could
   * only be created by entering a rate.
   */
  rateEntered?: boolean
}

export interface MedicareRateSources {
  /** Hand-entered per-group values — the most deliberate signal, wins. */
  overrides?: MedicareRateOverrideInput[] | null
  /** An uploaded CMS table (newer year, or locality-adjusted). */
  uploaded?: MedicareAscRate[] | null
}

/**
 * THE canonical rate lookup. Precedence, most authoritative first:
 *
 *   1. `authoritative` — a hand-entered override for this group
 *   2. `uploaded`      — a row in the selected uploaded rate table
 *   3. `estimate`      — the built-in CY2025 national snapshot
 *
 * Every surface resolves through this, so the number shown on the Medicare
 * card, the number the engine bills incremental cases at, and the number a
 * saved proposal recomputes on can never disagree.
 *
 * Group matching is case/whitespace-insensitive at every tier — uploaded and
 * hand-entered group names come from human input.
 */
export function resolveMedicareAscRate(
  group: string,
  sources: MedicareRateSources = {},
): ResolvedMedicareRate | undefined {
  const key = normalizeGroupName(group)

  const override = sources.overrides?.find(
    (r) => normalizeGroupName(r.group) === key,
  )
  const uploaded = sources.uploaded?.find(
    (r) => normalizeGroupName(r.group) === key,
  )
  const builtIn = getMedicareAscRate(group)

  if (override) {
    // A hand-entered RATE is authoritative and wins outright.
    if (override.rateEntered !== false) {
      return { ...override, source: "authoritative" }
    }
    // Presentation-only override: keep the user's label/note/code, but the
    // NUMBER — and therefore the trust badge — still belongs to the tier
    // underneath. Painting "Authoritative" on an unverified placeholder
    // because someone renamed the row would actively mislead.
    const underlying = uploaded ?? builtIn
    if (!underlying) return undefined
    return {
      ...underlying,
      label: override.label,
      note: override.note ?? underlying.note,
      code: override.code || underlying.code,
      source: uploaded ? "uploaded" : "estimate",
    }
  }

  if (uploaded) return { ...uploaded, source: "uploaded" }
  return builtIn ? { ...builtIn, source: "estimate" } : undefined
}

/**
 * The merged table the rate editor renders: every built-in group, plus any
 * uploaded or hand-added group that isn't in it, each carrying its source.
 * Sorted by display name.
 */
export function listEffectiveMedicareRates(
  sources: MedicareRateSources = {},
): ResolvedMedicareRate[] {
  const seen = new Set<string>()
  const rows: ResolvedMedicareRate[] = []

  const push = (group: string) => {
    const key = normalizeGroupName(group)
    if (seen.has(key)) return
    seen.add(key)
    const resolved = resolveMedicareAscRate(group, sources)
    if (resolved) rows.push(resolved)
  }

  for (const r of RATES) push(r.group)
  for (const r of sources.uploaded ?? []) push(r.group)
  for (const r of sources.overrides ?? []) push(r.group)

  return rows.sort((a, b) =>
    (a.label || a.group).localeCompare(b.label || b.group),
  )
}

/** Effective facility reimbursement per case = Medicare rate × % of Medicare. */
export function effectiveReimbursementPerCase(
  medicareRate: number,
  percentOfMedicare: number,
): number {
  return Math.round(medicareRate * (percentOfMedicare / 100))
}
