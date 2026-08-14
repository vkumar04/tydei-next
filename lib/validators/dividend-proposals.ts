import { z } from "zod"

// Zod contracts for the vendor Dividend/DCF tab: the saved-proposal payload
// (full scenario snapshot in `DividendProposal.payload`) and the payor-volume
// ingestion metadata. Every JSON-column write is validated here first, per
// the prospective-actions convention.

/** Generous magnitude cap — rejects Infinity/NaN and absurd inputs without
 *  constraining any real facility statement. */
const money = z.number().finite().gte(-1e12).lte(1e12)
const cases = z.number().finite().gte(0).lte(10_000_000)

export const proformaLineItemsSchema = z.object({
  standardBillingRevenue: money,
  contractualAdjustment: money,
  salaryBenefits: money,
  medicalSupplies: money,
  smallEquipment: money,
  officeExpenses: money,
  legal: money,
  computerServices: money,
  managementFees: money,
  billingCollection: money,
  otherOutsideServices: money,
  insurance: money,
  administrative: money,
  rentTiUtilities: money,
  otherFacility: money,
  repairsMaintenance: money,
  propTax: money,
  stateTaxes: money,
  softwareMaintenance: money,
  equipRentInterestOther: money,
  caseVolume: cases,
})

export const purchaseScenarioSchema = z.object({
  productName: z.string().max(300),
  supplyCostDeltaPerCase: money,
  affectedCases: cases,
  incrementalCases: cases,
  revenueDeltaPerCase: money,
  capitalOutlay: money,
  /** Amortization life for the capital charge; defaults to the DCF horizon. */
  capitalUsefulLifeYears: z.number().finite().gt(0).lte(100).optional(),
  recurringAnnualCost: money,
  /** Defined ⇒ incremental cases bill at exactly this rate (incl. $0). */
  caseReimbursement: z.number().finite().gte(0).lte(1e9).optional(),
})

/** One hand-entered authoritative rate. */
export const medicareRateOverrideSchema = z.object({
  group: z.string().trim().min(1).max(200),
  label: z.string().max(200).optional(),
  code: z.string().max(60),
  medicareRate: z.number().finite().gte(0).lte(1_000_000),
  note: z.string().max(500).optional(),
  /** False for a label/note-only edit — see MedicareRateOverride.rateEntered. */
  rateEntered: z.boolean().optional(),
})

/** The DCF assumption set a proposal was priced under. Every value is a
 *  FRACTION per the engine units convention — 0.8, not 80. */
export const dividendAssumptionsSchema = z.object({
  dcfPctOfEbitda: z.number().finite().gte(0).lte(1),
  discountRatePct: z.number().finite().gte(0).lte(1),
  cashFlowGrowthPct: z.number().finite().gte(-1).lte(1),
  dcfProjectionYears: z.number().finite().gte(1).lte(50),
})

export const dividendProposalPayloadSchema = z.object({
  lineItems: proformaLineItemsSchema,
  purchase: purchaseScenarioSchema,
  /**
   * The assumptions the saved figures were computed under. They OUTRANK any
   * later default, same rationale as `medicareRateOverrides` below — a linked
   * surface must not have to guess the growth/discount convention behind
   * `summary.netPresentValue`. Optional so payloads saved before this field
   * existed still load; the fallback is DEFAULT_DIVIDEND_ASSUMPTIONS, which is
   * what those were priced with.
   */
  assumptions: dividendAssumptionsSchema.optional(),
  payorGroupNames: z.array(z.string().max(200)).max(200).default([]),
  /** Per-quarter volume overrides, keyed `group::YYYY-Qn`. Entry count is
   *  capped so a crafted payload can't balloon the Json column. */
  quarterEdits: z
    .record(z.string().max(250), cases)
    .default({})
    .refine((o) => Object.keys(o).length <= 2_000, {
      message: "Too many quarter edits",
    }),
  /** Whole percent (120 = 1.2× Medicare). */
  percentOfMedicare: z.number().finite().gte(0).lte(1_000),
  medicareRateOverride: z.number().finite().gte(0).lte(1e9).nullable(),
  /**
   * Which uploaded rate table was applied; null = the built-in CY2025 snapshot.
   * Persisted so reopening a proposal cannot silently recompute the blended
   * rate against a different table than the one it was saved with. Optional so
   * proposals saved before rate sets existed still load.
   */
  medicareRateSetId: z.string().max(64).nullable().optional(),
  /**
   * The authoritative rates in force when the proposal was saved. They OUTRANK
   * the rate set, so recording only `medicareRateSetId` would let a later rate
   * edit silently change a saved proposal's figures. Optional so proposals
   * saved before overrides existed still load.
   */
  medicareRateOverrides: z.array(medicareRateOverrideSchema).max(500).optional(),
})

export type DividendProposalPayload = z.infer<typeof dividendProposalPayloadSchema>

export const dividendVerdictSchema = z.enum(["accretive", "dilutive", "neutral"])

export const saveDividendProposalSchema = z.object({
  /** Present = update in place (vendor-scoped); absent = create. */
  id: z.string().max(64).optional(),
  name: z.string().min(1, "Give the proposal a name").max(200),
  facilityKey: z.string().max(300).nullable(),
  facilityLabel: z.string().min(1).max(300),
  payload: dividendProposalPayloadSchema,
  /** Denormalized headline results for the saved-proposals list. */
  summary: z.object({
    verdict: dividendVerdictSchema,
    noiImpact: money,
    annualDividendImpact: money,
    netPresentValue: money,
    // No upper bound: a tiny NOI gain against a large outlay legitimately
    // produces astronomical (but finite) payback years.
    paybackYears: z.number().finite().gte(0).nullable(),
  }),
})

export type SaveDividendProposalInput = z.infer<typeof saveDividendProposalSchema>

/** The ONLY part of a saved payload the dividend engine consumes. Everything
 *  else (quarterEdits, medicareRateOverrides) is provenance and cannot move a
 *  figure — split out so a row with drifted provenance still recomputes.
 *  `assumptions` IS included: it changes every number. */
export const dividendProposalImpactInputsSchema = z.object({
  lineItems: proformaLineItemsSchema,
  purchase: purchaseScenarioSchema,
  assumptions: dividendAssumptionsSchema.optional(),
})

export type DividendProposalImpactInputs = z.infer<
  typeof dividendProposalImpactInputsSchema
>

/** Ids for the contract ↔ saved-DCF-proposal link actions. Server-action args
 *  are deserialized client JSON and the declared `string` type is erased, so a
 *  crafted payload can put an object where a string is declared — and Prisma
 *  accepts `{ not: "" }` as a StringFilter, widening a `deleteMany` from one
 *  row to every row the vendor owns. */
export const contractDcfLinkInputSchema = z.object({
  contractId: z.string().trim().min(1).max(64),
  proposalId: z.string().trim().min(1).max(64),
})

export type ContractDcfLinkInput = z.infer<typeof contractDcfLinkInputSchema>

export const ingestPayorVolumeMetaSchema = z
  .object({
    fileName: z.string().min(1).max(300),
    /** Connected facility — must pass the vendor-related-facility predicate. */
    facilityId: z.string().max(64).optional(),
    /** Ad-hoc prospect facility name (unconnected). Trimmed BEFORE min(1) so
     *  a whitespace-only name can't mint an empty `adhoc:` bucket. */
    adhocName: z.string().trim().min(1).max(200).optional(),
  })
  .refine((v) => Boolean(v.facilityId) !== Boolean(v.adhocName), {
    message: "Provide exactly one of facilityId or adhocName",
  })

export type IngestPayorVolumeMeta = z.infer<typeof ingestPayorVolumeMetaSchema>

// ─── Stored payor-volume group shape ─────────────────────────────
// Validated at WRITE time (ingest) so the Json column only ever holds this
// shape; reads may then cast without re-parsing per row.

export const payorQuarterSchema = z.object({
  year: z.number().int().gte(1900).lte(2200),
  quarter: z.number().int().gte(1).lte(4),
  volume: cases,
})

export const payorProcedureGroupSchema = z.object({
  group: z.string().min(1).max(200),
  quarters: z.array(payorQuarterSchema).max(400),
  totalVolume: cases,
  annualizedVolume: cases,
})

export const payorProcedureGroupsSchema = z
  .array(payorProcedureGroupSchema)
  .max(500)

// ─── Uploaded proforma + Medicare rate set ───────────────────────

export const ingestProformaMetaSchema = z
  .object({
    fileName: z.string().min(1).max(300),
    facilityId: z.string().max(64).optional(),
    adhocName: z.string().trim().min(1).max(200).optional(),
  })
  .refine((v) => Boolean(v.facilityId) !== Boolean(v.adhocName), {
    message: "Provide exactly one of facilityId or adhocName",
  })

export type IngestProformaMeta = z.infer<typeof ingestProformaMetaSchema>

export const medicareAscRateSchema = z.object({
  group: z.string().min(1).max(200),
  /** Display-only rename; `group` stays the join key. */
  label: z.string().max(200).optional(),
  code: z.string().max(60),
  medicareRate: z.number().finite().gte(0).lte(1_000_000),
  note: z.string().max(500).optional(),
})

/** The editor saves every dirty row at once; cap the batch. */
/** The editor only ever posts hand-edited rows from a ~35-row table; 500
 *  matches the chunk size every other bulk write here uses. */
export const medicareRateOverridesSchema = z
  .array(medicareRateOverrideSchema)
  .max(500)

export const medicareAscRatesSchema = z.array(medicareAscRateSchema).max(2_000)

export const ingestMedicareRatesMetaSchema = z.object({
  fileName: z.string().min(1).max(300),
  /** User-given set name, e.g. "CY2026 National". */
  name: z.string().trim().min(1).max(120),
})

export type IngestMedicareRatesMeta = z.infer<
  typeof ingestMedicareRatesMetaSchema
>
