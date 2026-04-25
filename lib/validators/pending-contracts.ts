import { z } from "zod"
import { ContractTypeSchema, PendingContractStatusSchema } from "@/lib/validators"

export const createPendingContractSchema = z.object({
  vendorId: z.string().min(1, "Vendor is required"),
  vendorName: z.string().min(1),
  facilityId: z.string().optional(),
  facilityName: z.string().optional(),
  contractName: z.string().min(1, "Contract name is required"),
  contractType: ContractTypeSchema,
  effectiveDate: z.string().optional(),
  expirationDate: z.string().optional(),
  totalValue: z.number().min(0).optional(),
  // Charles 2026-04-25 (vendor-mirror Phase 2): field-parity columns
  // now backed by real DB columns on PendingContract. The vendor
  // submission UI was already collecting these in local state but
  // the server boundary dropped them — all optional so older clients
  // stay compatible.
  contractNumber: z.string().optional(),
  annualValue: z.number().min(0).optional(),
  gpoAffiliation: z.string().optional(),
  // Charles 2026-04-25 (vendor-mirror Phase 3 follow-up — B4):
  // tighten free-form `z.string()` to `z.enum([...])` matching the
  // PerformancePeriod / RebatePayPeriod Prisma enums. Pre-tightening
  // an arbitrary string from the vendor would land in PendingContract
  // unchecked, then throw at `prisma.contract.create()` when the
  // facility tried to approve.
  performancePeriod: z
    .enum(["monthly", "quarterly", "semi_annual", "annual"])
    .optional(),
  rebatePayPeriod: z
    .enum(["monthly", "quarterly", "semi_annual", "annual"])
    .optional(),
  autoRenewal: z.boolean().optional(),
  terminationNoticeDays: z.number().int().min(0).optional(),
  // Charles 2026-04-25 (vendor-mirror Phase 2 cont.): capital tie-in
  // fields. Persisted as their own columns so vendor submissions of
  // capital/tie-in contracts carry through approval cleanly.
  capitalCost: z.number().min(0).optional(),
  interestRate: z.number().min(0).max(1).optional(),
  termMonths: z.number().int().min(0).optional(),
  downPayment: z.number().min(0).optional(),
  paymentCadence: z.enum(["monthly", "quarterly", "annual"]).optional(),
  amortizationShape: z.enum(["symmetrical", "custom"]).optional(),
  terms: z.any().optional(),
  documents: z.any().optional(),
  pricingData: z.any().optional(),
  notes: z.string().optional(),
  division: z.string().optional(),
  tieInContractId: z.string().optional(),
})

export type CreatePendingContractInput = z.infer<typeof createPendingContractSchema>

export const updatePendingContractSchema = createPendingContractSchema.partial()

export type UpdatePendingContractInput = z.infer<typeof updatePendingContractSchema>

export const reviewPendingContractSchema = z.object({
  reviewedBy: z.string().min(1),
  notes: z.string().optional(),
})

export type ReviewPendingContractInput = z.infer<typeof reviewPendingContractSchema>
