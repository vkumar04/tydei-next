import { z } from "zod"
import { FacilityTypeSchema } from "@/lib/validators"

// ─── Facility Profile ────────────────────────────────────────────

export const updateFacilityProfileSchema = z.object({
  name: z.string().min(1, "Facility name is required"),
  type: FacilityTypeSchema,
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zip: z.string().optional(),
  beds: z.number().int().min(0).optional(),
  contactEmail: z.string().email().optional(),
  contactPhone: z.string().optional(),
})

export type UpdateFacilityProfileInput = z.infer<typeof updateFacilityProfileSchema>

// ─── Vendor Profile ──────────────────────────────────────────────

export const updateVendorProfileSchema = z.object({
  name: z.string().min(1, "Company name is required"),
  displayName: z.string().optional(),
  logoUrl: z.string().url().optional().or(z.literal("")),
  contactName: z.string().optional(),
  contactEmail: z.string().email().optional().or(z.literal("")),
  contactPhone: z.string().optional(),
  website: z.string().url().optional().or(z.literal("")),
  address: z.string().optional(),
  division: z.string().optional(),
})

export type UpdateVendorProfileInput = z.infer<typeof updateVendorProfileSchema>

// ─── Notification Preferences ────────────────────────────────────

export const notificationPreferencesSchema = z.object({
  expiringContracts: z.boolean(),
  tierThresholds: z.boolean(),
  rebateDue: z.boolean(),
  paymentDue: z.boolean(),
  offContract: z.boolean(),
  pricingErrors: z.boolean(),
  compliance: z.boolean(),
  emailEnabled: z.boolean(),
  inAppEnabled: z.boolean(),
})

export type NotificationPreferences = z.infer<typeof notificationPreferencesSchema>

// ─── Invite Team Member ──────────────────────────────────────────

export const inviteTeamMemberSchema = z.object({
  email: z.string().email("Valid email is required"),
  role: z.string().min(1, "Role is required"),
})

export type InviteTeamMemberInput = z.infer<typeof inviteTeamMemberSchema>

// ─── Spend Target ────────────────────────────────────────────────

export const spendTargetSchema = z.object({
  contractId: z.string().min(1),
  facilityId: z.string().min(1),
  targetSpend: z.number().positive("Target spend must be positive"),
  targetDate: z.string().min(1, "Target date is required"),
})

export type SpendTargetInput = z.infer<typeof spendTargetSchema>
