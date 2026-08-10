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
  recurringAnnualCost: money,
  /** Defined ⇒ incremental cases bill at exactly this rate (incl. $0). */
  caseReimbursement: z.number().finite().gte(0).lte(1e9).optional(),
})

export const dividendProposalPayloadSchema = z.object({
  lineItems: proformaLineItemsSchema,
  purchase: purchaseScenarioSchema,
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
