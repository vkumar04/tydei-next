import { z } from "zod"

// ─── CPT Rate ────────────────────────────────────────────────────

export const payorContractRateSchema = z.object({
  cptCode: z.string().min(1, "CPT code is required"),
  description: z.string().optional(),
  rate: z.number().min(0, "Rate must be positive"),
  effectiveDate: z.string().optional(),
})

export type PayorContractRate = z.infer<typeof payorContractRateSchema>

// ─── Grouper Rate ────────────────────────────────────────────────

export const payorContractGrouperSchema = z.object({
  grouperName: z.string().min(1, "Grouper name is required"),
  rate: z.number().min(0),
  cptCodes: z.array(z.string()).default([]),
})

export type PayorContractGrouper = z.infer<typeof payorContractGrouperSchema>

// ─── Create Payor Contract ──────────────────────────────────────

export const createPayorContractSchema = z.object({
  payorName: z.string().min(1, "Payor name is required"),
  payorType: z.enum(["commercial", "medicare_advantage", "medicaid_managed", "workers_comp"]),
  facilityId: z.string().min(1, "Facility is required"),
  // Optional: many executed amendments (e.g. the Anthem ASC amendment)
  // carry no agreement number. The create action derives a stable
  // fallback from payorName + effectiveDate so the NOT-NULL +
  // unique(facilityId, payorName, contractNumber) column is always set.
  contractNumber: z.string().optional(),
  effectiveDate: z.string().min(1, "Effective date is required"),
  expirationDate: z.string().min(1, "Expiration date is required"),
  status: z.string().default("active"),
  cptRates: z.array(payorContractRateSchema).default([]),
  grouperRates: z.array(payorContractGrouperSchema).default([]),
  implantPassthrough: z.boolean().default(true),
  implantMarkup: z.number().default(0),
  notes: z.string().optional(),
  fileName: z.string().max(300).optional(),
  // Storage KEY of the archived source document (from the extract route),
  // never an absolute URL. Ownership (caller minted it) is enforced in the
  // create action via keyBelongsToTenant.
  s3Key: z
    .string()
    .min(1)
    .max(500)
    .refine((v) => !/^[a-z][a-z0-9+.-]*:/i.test(v) && !v.startsWith("//"), {
      message: "s3Key must be a storage key, not a URL",
    })
    .optional(),
})

export const updatePayorContractSchema = createPayorContractSchema.partial()

export type CreatePayorContractInput = z.infer<typeof createPayorContractSchema>
export type UpdatePayorContractInput = z.infer<typeof updatePayorContractSchema>
