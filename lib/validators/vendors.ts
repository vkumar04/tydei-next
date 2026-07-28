import { z } from "zod"
import { emailSchema, optionalEmailSchema } from "@/lib/validators/email"
import { createPaginationSchema } from "./pagination"
import { VendorTierSchema } from "@/lib/validators"

// ─── Create Vendor ──────────────────────────────────────────────

export const createVendorSchema = z.object({
  name: z.string().min(1, "Vendor name is required"),
  code: z.string().optional(),
  displayName: z.string().optional(),
  division: z.string().optional(),
  contactName: z.string().optional(),
  contactEmail: optionalEmailSchema("Invalid email"),
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

/**
 * Largest page `getVendorList` will serve in one request.
 *
 * This is a transport cap, NOT a "how many vendors exist" answer. Facility
 * Settings → Vendors used to ask for `pageSize: 100` and render the result as
 * the whole list: production holds 200 vendors, so ranks 101 (KOVEN) through
 * 200 (Zimmer US, Inc.) — including "Stryker" at rank 176, which holds a live
 * contract — were simply invisible, with no pager and no row count to hint at
 * it. Raising the cap is not the fix; a truncation the UI cannot see is the
 * bug. Every caller must page through with `page` and show `total`.
 */
export const VENDOR_MAX_PAGE_SIZE = 100

/** Default rows per page for the vendor list surfaces. */
export const VENDOR_PAGE_SIZE = 25

export const vendorFiltersSchema = z.object({
  search: z.string().optional(),
  status: z.string().optional(),
  ...createPaginationSchema(VENDOR_MAX_PAGE_SIZE),
})

export type VendorFilters = z.infer<typeof vendorFiltersSchema>
