import { z } from "zod"

export const createReportScheduleSchema = z.object({
  facilityId: z.string().min(1),
  reportType: z.enum([
    "contract_performance",
    "rebate_summary",
    "spend_analysis",
    "market_share",
    "case_costing",
  ]),
  frequency: z.enum(["daily", "weekly", "monthly"]),
  dayOfWeek: z.number().int().min(0).max(6).optional(),
  dayOfMonth: z.number().int().min(1).max(28).optional(),
  emailRecipients: z.array(z.string().email()).min(1, "At least one recipient is required"),
  isActive: z.boolean().default(true),
})

export const updateReportScheduleSchema = createReportScheduleSchema.partial().omit({ facilityId: true })

export type CreateReportScheduleInput = z.infer<typeof createReportScheduleSchema>
export type UpdateReportScheduleInput = z.infer<typeof updateReportScheduleSchema>
