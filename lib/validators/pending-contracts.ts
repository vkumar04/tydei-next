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
  terms: z.any().optional(),
  documents: z.any().optional(),
  pricingData: z.any().optional(),
  notes: z.string().optional(),
})

export type CreatePendingContractInput = z.infer<typeof createPendingContractSchema>

export const updatePendingContractSchema = createPendingContractSchema.partial()

export type UpdatePendingContractInput = z.infer<typeof updatePendingContractSchema>

export const reviewPendingContractSchema = z.object({
  reviewedBy: z.string().min(1),
  notes: z.string().optional(),
})

export type ReviewPendingContractInput = z.infer<typeof reviewPendingContractSchema>
