/**
 * Non-"use server" internal helper for writing in-app notification rows.
 *
 * Pre-fix this lived as an exported "use server" function in
 * lib/actions/notifications/in-app.ts and was directly RPC-callable by
 * unauthenticated clients (audit Iter3-B2 — confirmed exploit:
 * Stryker user wrote a phishing notification into a foreign user's
 * inbox via the action endpoint).
 *
 * Per CLAUDE.md "use server hygiene": internal helpers MUST live in
 * non-"use server" modules so they cannot be invoked as a Next.js
 * Server Action. Callers that need to fan out notifications import
 * this helper from inside their already-authenticated server action.
 */
import { prisma } from "@/lib/db"

export async function createInAppNotificationsInternal(input: {
  userIds: string[]
  type: string
  title: string
  body?: string | null
  payload?: unknown
  actionUrl?: string | null
}): Promise<{ created: number }> {
  try {
    if (input.userIds.length === 0) return { created: 0 }
    const result = await prisma.notification.createMany({
      data: input.userIds.map((userId) => ({
        userId,
        type: input.type,
        title: input.title,
        body: input.body ?? null,
        payload:
          input.payload === undefined
            ? undefined
            : (input.payload as never),
        actionUrl: input.actionUrl ?? null,
      })),
    })
    return { created: result.count }
  } catch (err) {
    console.warn("[createInAppNotificationsInternal] failed", err)
    return { created: 0 }
  }
}
