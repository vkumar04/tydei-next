import { z } from "zod"
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
  contactEmail: z.string().email().optional().or(z.literal("")),
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
  email: z.string().email("Invalid email"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  role: UserRoleSchema,
  organizationId: z.string().optional(),
})

export const adminUpdateUserSchema = z.object({
  name: z.string().min(2).optional(),
  email: z.string().email().optional(),
  role: UserRoleSchema.optional(),
  organizationId: z.string().optional(),
})

export type AdminCreateUserInput = z.infer<typeof adminCreateUserSchema>
export type AdminUpdateUserInput = z.infer<typeof adminUpdateUserSchema>
