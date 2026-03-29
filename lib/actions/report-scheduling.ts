"use server"

import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import type {
  CreateReportScheduleInput,
  UpdateReportScheduleInput,
} from "@/lib/validators/report-scheduling"

// ─── List Schedules ─────────────────────────────────────────────

export async function getReportSchedules(facilityId: string) {
  await requireFacility()

  const schedules = await prisma.reportSchedule.findMany({
    where: { facilityId },
    orderBy: { createdAt: "desc" },
  })

  return schedules.map((s) => ({
    ...s,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
    lastSentAt: s.lastSentAt?.toISOString() ?? null,
  }))
}

// ─── Create Schedule ────────────────────────────────────────────

export async function createReportSchedule(input: CreateReportScheduleInput) {
  await requireFacility()

  return prisma.reportSchedule.create({ data: input })
}

// ─── Update Schedule ────────────────────────────────────────────

export async function updateReportSchedule(id: string, input: UpdateReportScheduleInput) {
  await requireFacility()

  return prisma.reportSchedule.update({ where: { id }, data: input })
}

// ─── Delete Schedule ────────────────────────────────────────────

export async function deleteReportSchedule(id: string) {
  await requireFacility()

  await prisma.reportSchedule.delete({ where: { id } })
}

// ─── Toggle Active ──────────────────────────────────────────────

export async function toggleReportSchedule(id: string) {
  await requireFacility()

  const schedule = await prisma.reportSchedule.findUniqueOrThrow({
    where: { id },
  })

  return prisma.reportSchedule.update({
    where: { id },
    data: { isActive: !schedule.isActive },
  })
}
