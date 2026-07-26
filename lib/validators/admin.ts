import { z } from "zod"
import { emailSchema, optionalEmailSchema } from "@/lib/validators/email"
import { FacilityTypeSchema, UserRoleSchema, VendorTierSchema } from "@/lib/validators"

// ─── Admin Facility ──────────────────────────────────────────────

export const adminCreateFacilitySchema = z.object({
  name: z.string().min(1, "Name is required"),
  type: FacilityTypeSchema,
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zip: z.string().optional(),
  beds: z.number().int().min(0).optional(),
  healthSystemId: z.string().optional(),
  status: z.string().optional(),
})

export const adminUpdateFacilitySchema = adminCreateFacilitySchema.partial()

export type AdminCreateFacilityInput = z.infer<typeof adminCreateFacilitySchema>
export type AdminUpdateFacilityInput = z.infer<typeof adminUpdateFacilitySchema>

// ─── Admin Vendor ────────────────────────────────────────────────

export const adminCreateVendorSchema = z.object({
  name: z.string().min(1, "Name is required"),
  code: z.string().optional(),
  displayName: z.string().optional(),
  division: z.string().optional(),
  contactName: z.string().optional(),
  contactEmail: optionalEmailSchema(),
  contactPhone: z.string().optional(),
  website: z.string().optional(),
  address: z.string().optional(),
  status: z.string().optional(),
  tier: VendorTierSchema.optional(),
})

export const adminUpdateVendorSchema = adminCreateVendorSchema.partial()

export type AdminCreateVendorInput = z.infer<typeof adminCreateVendorSchema>
export type AdminUpdateVendorInput = z.infer<typeof adminUpdateVendorSchema>

// ─── Admin User ──────────────────────────────────────────────────

export const adminCreateUserSchema = z.object({
  name: z.string().min(2, "Name is required"),
  email: emailSchema("Invalid email"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  role: UserRoleSchema,
  // NOTE: `organizationId` was removed 2026-07-26 — the User model has no
  // such column (org membership lives on Member), so passing it through to
  // prisma.user.create would have thrown. The admin form never sent it.
})

export const adminUpdateUserSchema = z.object({
  name: z.string().min(2).optional(),
  email: optionalEmailSchema(),
  role: UserRoleSchema.optional(),
  organizationId: z.string().optional(),
})

export type AdminCreateUserInput = z.infer<typeof adminCreateUserSchema>
export type AdminUpdateUserInput = z.infer<typeof adminUpdateUserSchema>
