import { prisma } from "@/lib/db"
import type { Prisma } from "@prisma/client"

interface AuditLogParams {
  userId: string
  action: string
  entityType: string
  entityId?: string
  metadata?: Prisma.InputJsonValue
  ipAddress?: string
}

/**
 * Log an audit event. Fire-and-forget — errors are caught and logged
 * so they never break the calling action.
 */
export async function logAudit(params: AuditLogParams): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: params.userId,
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId ?? null,
        metadata: params.metadata ?? undefined,
        ipAddress: params.ipAddress ?? null,
      },
    })
  } catch (error) {
    // Never let audit logging break a user-facing action
    console.error("[audit] Failed to write audit log:", error)
  }
}
