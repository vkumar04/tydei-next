import { z } from "zod"
import { createPaginationSchema } from "./pagination"
import { AlertTypeSchema, AlertStatusSchema, AlertSeveritySchema } from "@/lib/validators"

export const alertFiltersSchema = z.object({
  facilityId: z.string().optional(),
  vendorId: z.string().optional(),
  portalType: z.enum(["facility", "vendor"]),
  alertType: AlertTypeSchema.optional(),
  severity: AlertSeveritySchema.optional(),
  status: AlertStatusSchema.optional(),
  ...createPaginationSchema(100),
})

export type AlertFilters = z.infer<typeof alertFiltersSchema>
