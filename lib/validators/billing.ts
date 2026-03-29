import { z } from "zod"

export const checkoutSessionSchema = z.object({
  priceId: z.string().min(1, "Price is required"),
  organizationId: z.string().min(1, "Organization is required"),
})

export type CheckoutSessionInput = z.infer<typeof checkoutSessionSchema>

export const updateCreditTierSchema = z.object({
  entityId: z.string().min(1),
  entityType: z.enum(["facility", "vendor"]),
  tierId: z.enum(["starter", "professional", "enterprise", "unlimited"]),
})

export type UpdateCreditTierInput = z.infer<typeof updateCreditTierSchema>
