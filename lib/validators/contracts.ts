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

export const createContractSchema = z.object({
  name: z.string().min(1, "Contract name is required"),
  contractNumber: z.string().optional(),
  vendorId: z.string().min(1, "Vendor is required"),
  facilityId: z.string().optional(),
  productCategoryId: z.string().optional(),
  categoryIds: z.array(z.string()),
  contractType: ContractTypeSchema,
  status: ContractStatusSchema,
  effectiveDate: z.string().min(1, "Effective date is required"),
  expirationDate: z.string().min(1, "Expiration date is required"),
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
})

export type CreateContractInput = z.infer<typeof createContractSchema>

// ─── Update Contract Schema ──────────────────────────────────────

export const updateContractSchema = createContractSchema.partial()

export type UpdateContractInput = z.infer<typeof updateContractSchema>
