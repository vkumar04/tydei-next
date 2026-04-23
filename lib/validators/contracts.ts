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
  tieInCapitalValue: z.number().optional(),
  tieInPayoffMonths: z.number().int().optional(),
  tieInCapitalContractId: z.string().optional(),
  // Charles W1.T — tie-in capital is contract-level. These fields live
  // on Contract directly so all rebate terms pay down one balance.
  capitalCost: z.number().nullable().optional(),
  interestRate: z.number().nullable().optional(),
  termMonths: z.number().int().nullable().optional(),
  downPayment: z.number().min(0).nullable().optional(),
  paymentCadence: z.enum(["monthly", "quarterly", "annual"]).nullable().optional(),
  amortizationShape: z.enum(["symmetrical", "custom"]).optional(),
  customAmortizationRows: z
    .array(
      z.object({
        periodNumber: z.number().int().min(1),
        amortizationDue: z.number().min(0),
      }),
    )
    .optional(),
  // Charles W1.W-E1 — optional client-generated idempotency key. The
  // server keeps a 30s TTL map of (key → contractId) so a double-click
  // on "Create Contract" returns the original contract instead of
  // writing a duplicate row. Clients generate one cuid per form session.
  idempotencyKey: z.string().min(1).optional(),
})

export const createContractSchema = createContractBase.refine(
  // Contract Total is the lifetime ceiling; Annual Value is at most
  // one year of that ceiling. A multi-year contract has
  // totalValue = annualValue × years, so annual > total is
  // definitionally impossible. Catches stale auto-compute that
  // doesn't re-fire after the user manually edits one of the two.
  (v) => v.annualValue <= v.totalValue + 0.01,
  {
    message: "Annual Value cannot exceed Contract Total. For a multi-year contract, Contract Total should be Annual × years.",
    path: ["annualValue"],
  },
)

export type CreateContractInput = z.infer<typeof createContractSchema>

// ─── Update Contract Schema ──────────────────────────────────────

// Reason for base+refine split: zod forbids .partial() on schemas with
// refinements. Update path therefore uses the unrefined base — callers
// that need the annual≤total rule should pass the full object through
// createContractSchema.
export const updateContractSchema = createContractBase.partial()

export type UpdateContractInput = z.infer<typeof updateContractSchema>
