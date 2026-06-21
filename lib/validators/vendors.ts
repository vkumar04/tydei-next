import { z } from "zod"
import { createPaginationSchema } from "./pagination"
import { VendorTierSchema } from "@/lib/validators"

// ─── Create Vendor ──────────────────────────────────────────────

export const createVendorSchema = z.object({
  name: z.string().min(1, "Vendor name is required"),
  code: z.string().optional(),
  displayName: z.string().optional(),
  division: z.string().optional(),
  contactName: z.string().optional(),
  contactEmail: z.email("Invalid email").optional().or(z.literal("")),
  contactPhone: z.string().optional(),
  website: z.url("Invalid URL").optional().or(z.literal("")),
  address: z.string().optional(),
  tier: VendorTierSchema,
})

export type CreateVendorInput = z.infer<typeof createVendorSchema>

// ─── Update Vendor ──────────────────────────────────────────────

export const updateVendorSchema = createVendorSchema.partial()

export type UpdateVendorInput = z.infer<typeof updateVendorSchema>

// ─── Vendor Filters ─────────────────────────────────────────────

export const vendorFiltersSchema = z.object({
  search: z.string().optional(),
  status: z.string().optional(),
  ...createPaginationSchema(100),
})

export type VendorFilters = z.infer<typeof vendorFiltersSchema>
