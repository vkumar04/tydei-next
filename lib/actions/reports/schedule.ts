"use server"

/**
 * Reports hub — ReportSchedule CRUD actions.
 *
 * Backs the "Scheduled Reports" dialog on /dashboard/reports. All
 * actions are scoped to the caller's active facility via
 * `requireFacility`; each mutation re-verifies ownership on the row.
 *
 * Delivery (cron-based dispatch) is out of scope — see the spec §5 and
 * the non-dismissable banner in the UI. This module is settings-only.
 *
 * Reference: docs/superpowers/specs/2026-04-18-reports-hub-rewrite.md §4.0
 */
import { z } from "zod"
import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { serialize } from "@/lib/serialize"
import type { ReportType, ReportFrequency } from "@prisma/client"

// ─── Input surface ──────────────────────────────────────────────

/**
 * Report types the spec exposes (per §5 / canonical docs §6). Mapped
 * to the Prisma `ReportType` enum in `toDbReportType` since the DB
 * enum only carries the 5 high-level buckets.
 */
const SPEC_REPORT_TYPES = [
  "usage",
  "capital",
  "service",
  "tie_in",
  "grouped",
  "pricing_only",
  "discrepancy",
] as const
type SpecReportType = (typeof SPEC_REPORT_TYPES)[number]

/**
 * Frequencies the spec exposes. `quarterly` is not in the DB
 * `ReportFrequency` enum — we persist as `monthly` with
 * `dayOfMonth = 1` as a pragmatic fallback until the enum is
 * extended (tracked in the reports-hub spec risks section).
 */
const SPEC_FREQUENCIES = ["daily", "weekly", "monthly", "quarterly"] as const
type SpecFrequency = (typeof SPEC_FREQUENCIES)[number]

export interface CreateReportScheduleActionInput {
  name: string
  reportType: SpecReportType
  frequency: SpecFrequency
  recipients: string[]
  includeCharts?: boolean
  includeLineItems?: boolean
}

export type UpdateReportScheduleActionInput = Partial<CreateReportScheduleActionInput>

// ─── Return shape ───────────────────────────────────────────────

/**
 * Serialized projection of `prisma.reportSchedule` with dates
 * converted to ISO strings (for the client boundary).
 */
export interface ReportSchedule {
  id: string
  facilityId: string
  reportType: ReportType
  frequency: ReportFrequency
  dayOfWeek: number | null
  dayOfMonth: number | null
  emailRecipients: string[]
  isActive: boolean
  lastSentAt: string | null
  createdAt: string
  updatedAt: string
}

// ─── Validation ─────────────────────────────────────────────────

const createSchema = z.object({
  name: z.string().min(1, "Name is required"),
  reportType: z.enum(SPEC_REPORT_TYPES),
  frequency: z.enum(SPEC_FREQUENCIES),
  recipients: z
    .array(z.string().email("Invalid email"))
    .min(1, "At least one recipient is required"),
  includeCharts: z.boolean().optional(),
  includeLineItems: z.boolean().optional(),
})

const updateSchema = createSchema.partial()

// ─── Mappers (spec input → DB enum) ─────────────────────────────

function toDbReportType(type: SpecReportType): ReportType {
  switch (type) {
    case "discrepancy":
      return "spend_analysis"
    // All the per-contract-type report tabs roll up into the
    // generic "contract_performance" DB bucket until the enum gains
    // type-specific values.
    case "usage":
    case "capital":
    case "service":
    case "tie_in":
    case "grouped":
    case "pricing_only":
      return "contract_performance"
  }
}

function toDbFrequency(freq: SpecFrequency): {
  frequency: ReportFrequency
  dayOfMonth?: number | null
} {
  switch (freq) {
    case "daily":
      return { frequency: "daily" }
    case "weekly":
      return { frequency: "weekly" }
    case "monthly":
      return { frequency: "monthly" }
    case "quarterly":
      // DB enum lacks `quarterly`. Persist as monthly with a fixed day
      // and let the cron dispatcher (future work) gate firing to the
      // first month of each calendar quarter.
      return { frequency: "monthly", dayOfMonth: 1 }
  }
}

// ─── Actions ────────────────────────────────────────────────────

export async function listReportSchedules(): Promise<ReportSchedule[]> {
  const { facility } = await requireFacility()

  const rows = await prisma.reportSchedule.findMany({
    where: { facilityId: facility.id },
    orderBy: { createdAt: "desc" },
  })

  return serialize(
    rows.map((r) => ({
      id: r.id,
      facilityId: r.facilityId,
      reportType: r.reportType,
      frequency: r.frequency,
      dayOfWeek: r.dayOfWeek,
      dayOfMonth: r.dayOfMonth,
      emailRecipients: r.emailRecipients,
      isActive: r.isActive,
      lastSentAt: r.lastSentAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    })),
  )
}

export async function createReportSchedule(
  input: CreateReportScheduleActionInput,
): Promise<ReportSchedule> {
  const { facility } = await requireFacility()
  const parsed = createSchema.parse(input)

  const { frequency, dayOfMonth } = toDbFrequency(parsed.frequency)

  const row = await prisma.reportSchedule.create({
    data: {
      facilityId: facility.id,
      reportType: toDbReportType(parsed.reportType),
      frequency,
      dayOfMonth: dayOfMonth ?? null,
      emailRecipients: parsed.recipients,
      isActive: true,
    },
  })

  return serialize({
    id: row.id,
    facilityId: row.facilityId,
    reportType: row.reportType,
    frequency: row.frequency,
    dayOfWeek: row.dayOfWeek,
    dayOfMonth: row.dayOfMonth,
    emailRecipients: row.emailRecipients,
    isActive: row.isActive,
    lastSentAt: row.lastSentAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  })
}

export async function updateReportSchedule(
  id: string,
  input: UpdateReportScheduleActionInput,
): Promise<ReportSchedule> {
  const { facility } = await requireFacility()
  const parsed = updateSchema.parse(input)

  // Ownership check — only touch rows in this facility.
  const existing = await prisma.reportSchedule.findFirst({
    where: { id, facilityId: facility.id },
    select: { id: true },
  })
  if (!existing) {
    throw new Error("Report schedule not found")
  }

  const data: {
    reportType?: ReportType
    frequency?: ReportFrequency
    dayOfMonth?: number | null
    emailRecipients?: string[]
  } = {}
  if (parsed.reportType) data.reportType = toDbReportType(parsed.reportType)
  if (parsed.frequency) {
    const mapped = toDbFrequency(parsed.frequency)
    data.frequency = mapped.frequency
    if (mapped.dayOfMonth !== undefined) data.dayOfMonth = mapped.dayOfMonth
  }
  if (parsed.recipients) data.emailRecipients = parsed.recipients

  const row = await prisma.reportSchedule.update({
    where: { id },
    data,
  })

  return serialize({
    id: row.id,
    facilityId: row.facilityId,
    reportType: row.reportType,
    frequency: row.frequency,
    dayOfWeek: row.dayOfWeek,
    dayOfMonth: row.dayOfMonth,
    emailRecipients: row.emailRecipients,
    isActive: row.isActive,
    lastSentAt: row.lastSentAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  })
}

export async function deleteReportSchedule(id: string): Promise<void> {
  const { facility } = await requireFacility()

  const existing = await prisma.reportSchedule.findFirst({
    where: { id, facilityId: facility.id },
    select: { id: true },
  })
  if (!existing) {
    throw new Error("Report schedule not found")
  }

  await prisma.reportSchedule.delete({ where: { id } })
}
