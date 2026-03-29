"use server"

import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import type {
  CreateReportScheduleInput,
  UpdateReportScheduleInput,
} from "@/lib/validators/report-scheduling"
import { serialize } from "@/lib/serialize"

// ─── List Schedules ─────────────────────────────────────────────

export async function getReportSchedules(facilityId: string) {
  await requireFacility()

  const schedules = await prisma.reportSchedule.findMany({
    where: { facilityId },
    orderBy: { createdAt: "desc" },
  })

  return serialize(schedules.map((s) => ({
    ...s,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
    lastSentAt: s.lastSentAt?.toISOString() ?? null,
  })))
}

// ─── Create Schedule ────────────────────────────────────────────

export async function createReportSchedule(input: CreateReportScheduleInput) {
  await requireFacility()

  const schedule = await prisma.reportSchedule.create({ data: input })
  return serialize(schedule)
}

// ─── Update Schedule ────────────────────────────────────────────

export async function updateReportSchedule(id: string, input: UpdateReportScheduleInput) {
  await requireFacility()

  const schedule = await prisma.reportSchedule.update({ where: { id }, data: input })
  return serialize(schedule)
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

  const updated = await prisma.reportSchedule.update({
    where: { id },
    data: { isActive: !schedule.isActive },
  })
  return serialize(updated)
}
