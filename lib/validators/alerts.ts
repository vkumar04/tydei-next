import { z } from "zod"
import { AlertTypeSchema, AlertStatusSchema, AlertSeveritySchema } from "@/lib/validators"

export const alertFiltersSchema = z.object({
  facilityId: z.string().optional(),
  vendorId: z.string().optional(),
  portalType: z.enum(["facility", "vendor"]),
  alertType: AlertTypeSchema.optional(),
  severity: AlertSeveritySchema.optional(),
  status: AlertStatusSchema.optional(),
  page: z.number().int().min(1).optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
})

export type AlertFilters = z.infer<typeof alertFiltersSchema>
