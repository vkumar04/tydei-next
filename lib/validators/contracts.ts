import { z } from "zod"
import {
  ContractTypeSchema,
  ContractStatusSchema,
  PerformancePeriodSchema,
} from "@/lib/validators"

// ─── Filter Schema ───────────────────────────────────────────────

export const contractFiltersSchema = z.object({
  search: z.string().optional(),
  status: ContractStatusSchema.optional(),
  type: ContractTypeSchema.optional(),
  facilityId: z.string().optional(),
  facilityScope: z.enum(["this", "all", "shared"]).optional().default("this"),
  page: z.number().int().min(1).optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
})

export type ContractFilters = z.input<typeof contractFiltersSchema>

// ─── Create Contract Schema ──────────────────────────────────────

// Base fields — factored out so `.partial()` for updateContractSchema
// works (zod refines block .partial()). Keep the refine on the create
// schema only; updates can legitimately ship a partial payload.
const createContractBase = z.object({
  name: z.string().min(1, "Contract name is required"),
  contractNumber: z.string().optional(),
  vendorId: z.string().min(1, "Vendor is required"),
  facilityId: z.string().optional(),
  productCategoryId: z.string().optional(),
  categoryIds: z.array(z.string()),
  contractType: ContractTypeSchema,
  status: ContractStatusSchema,
  effectiveDate: z.string().min(1, "Effective date is required"),
  // Empty string = evergreen (no fixed expiration). The server action
  // writes null to Prisma when this is "", and `lib/contracts/match.ts`
  // treats null as "no upper bound" so every future COG row still
  // matches. See app/api/ai/extract-contract/route.ts for how the AI
  // extractor returns null for auto-renewing contracts.
  expirationDate: z.string(),
  autoRenewal: z.boolean(),
  terminationNoticeDays: z.number().int().min(0),
  totalValue: z.number().min(0),
  annualValue: z.number().min(0),
  description: z.string().optional(),
  notes: z.string().optional(),
  gpoAffiliation: z.string().optional(),
  performancePeriod: PerformancePeriodSchema,
  rebatePayPeriod: PerformancePeriodSchema,
  isMultiFacility: z.boolean(),
  isGrouped: z.boolean().optional(),
  facilityIds: z.array(z.string()),
  additionalFacilityIds: z.array(z.string()).optional(),
  // 2026-04-28: tieInCapitalValue + tieInPayoffMonths removed —
  // they were stale validator fields with no Prisma column and no
  // action write-path (surfaced by contract-schema-parity.test.ts).
  // Capital lives on ContractCapitalLineItem rows.
  tieInCapitalContractId: z.string().optional(),
  // Charles audit suggestion #4 (v0-port): legacy contract-level
  // capital fields removed — capital lives in
  // ContractCapitalLineItem rows, managed via the dedicated
  // capital-line-items.ts CRUD actions. Only amortizationShape
  // survives at the contract level.
  amortizationShape: z.enum(["symmetrical", "custom"]).optional(),
  // Charles 2026-04-25 (audit follow-up): contract-level metrics
  // that drive compliance_rebate + market_share term computations.
  // Compliance % is what % of purchases comply with contract terms;
  // current/target market share % is the vendor's actual + commitment.
  // All optional + nullable so existing contracts stay valid.
  complianceRate: z.number().min(0).max(100).nullable().optional(),
  currentMarketShare: z.number().min(0).max(100).nullable().optional(),
  marketShareCommitment: z.number().min(0).max(100).nullable().optional(),
  /**
   * Charles 2026-04-25 (audit follow-up): per-category commitment
   * targets. Pairs with `getCategoryMarketShareForVendor` which
   * returns the live actuals; this stores the user's target side.
   */
  marketShareCommitmentByCategory: z
    .array(
      z.object({
        category: z.string().min(1),
        commitmentPct: z.number().min(0).max(100),
      }),
    )
    .nullable()
    .optional(),
  // Charles audit suggestion #4 (v0-port): customAmortizationRows
  // removed — per-asset payment schedules now live on
  // ContractCapitalLineItem (paymentType="variable") rather than
  // a single contract-level table.
  // Charles W1.W-E1 — optional client-generated idempotency key. The
  // server keeps a 30s TTL map of (key → contractId) so a double-click
  // on "Create Contract" returns the original contract instead of
  // writing a duplicate row. Clients generate one cuid per form session.
  idempotencyKey: z.string().min(1).optional(),
})

// Charles 2026-04-26: dropped the `annualValue <= totalValue` refine.
// The form now ALWAYS computes annualValue from totalValue ÷ contract
// years (and clamps it server-side too — see _createContractImpl /
// _updateContractImpl). Surfacing a validation error to the user when
// the system itself owns the field made the form feel broken when
// auto-compute lagged or the user pasted a multi-year total.
export const createContractSchema = createContractBase

export type CreateContractInput = z.infer<typeof createContractSchema>

// ─── Update Contract Schema ──────────────────────────────────────

// Reason for base+refine split: zod forbids .partial() on schemas with
// refinements. Update path therefore uses the unrefined base — callers
// that need the annual≤total rule should pass the full object through
// createContractSchema.
export const updateContractSchema = createContractBase.partial()

export type UpdateContractInput = z.infer<typeof updateContractSchema>
