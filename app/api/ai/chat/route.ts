import {
  streamText,
  convertToModelMessages,
  stepCountIs,
  type UIMessage,
} from "ai"
import { z } from "zod"
import { headers } from "next/headers"
import { auth } from "@/lib/auth-server"
import { claudeModel } from "@/lib/ai/config"
import {
  buildVendorChatTools,
  buildFacilityChatTools,
} from "@/lib/ai/tools"
import {
  buildFacilitySystemPrompt,
  buildVendorSystemPrompt,
} from "@/lib/ai/prompts"
import { rateLimit } from "@/lib/rate-limit"
import { prisma } from "@/lib/db"
import { recordClaudeUsage } from "@/lib/ai/record-usage"

/**
 * Chat-message body schema.
 *
 * AI SDK v6's `useChat` client sends UIMessage rows with a `parts` array
 * (each part has a `type` and per-type payload). Older payloads also
 * carried a top-level `content` string. We accept either shape — the
 * SDK's `convertToModelMessages` works off `parts`, but legacy callers
 * that send `content` (and our previous server schema) must keep working.
 *
 * This is a permissive schema by design: the auth/scope is enforced in
 * the tool factory below, so accepting "either shape" cannot widen the
 * data-leak surface. It only widens the parse-success surface so the
 * production UI stops 400-ing.
 */
const chatBodySchema = z.object({
  messages: z.array(
    z
      .object({
        id: z.string(),
        role: z.enum(["user", "assistant", "system"]),
        content: z.string().optional(),
        parts: z
          .array(
            z
              .object({ type: z.string() })
              .passthrough(),
          )
          .optional(),
      })
      .passthrough()
      .refine(
        (m) => typeof m.content === "string" || Array.isArray(m.parts),
        { message: "message must have content or parts" },
      ),
  ),
  portalType: z.enum(["facility", "vendor"]),
})

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return new Response("Unauthorized", { status: 401 })
  }

  const { success, retryAfterMs } = rateLimit(`ai-chat:${session.user.id}`, 20, 60_000)
  if (!success) {
    return Response.json(
      { error: "Too many requests", retryAfter: Math.ceil(retryAfterMs / 1000) },
      { status: 429 }
    )
  }

  const parsed = chatBodySchema.safeParse(await request.json())
  if (!parsed.success) {
    return Response.json({ error: "Invalid request body" }, { status: 400 })
  }
  const { messages, portalType } = parsed.data

  // Resolve the owning entity (facility or vendor) for usage attribution
  // AND for tool-scope binding. The tenant id MUST come from the session
  // join, never from the request body — see docs/architecture/role-model.md.
  const member = await prisma.member.findFirst({
    where: { userId: session.user.id },
    include: {
      organization: { include: { facility: true, vendor: true } },
    },
  })
  const facility = member?.organization?.facility ?? null
  const vendor = member?.organization?.vendor ?? null
  const facilityId = facility?.id ?? null
  const vendorId = vendor?.id ?? null

  // Reject requests that don't have the membership the portalType claims.
  // A facility-portal request from a vendor user (or vice versa) should not
  // be silently routed — the tools are tenant-scoped, so the wrong portal
  // would just return empty data, but this rejection is more honest.
  if (portalType === "vendor" && !vendorId) {
    return Response.json(
      { error: "Vendor membership required for vendor portal chat" },
      { status: 403 },
    )
  }
  if (portalType === "facility" && !facilityId) {
    return Response.json(
      { error: "Facility membership required for facility portal chat" },
      { status: 403 },
    )
  }

  // Build the tool set bound to this caller's tenant. Foreign ids cannot
  // leak even if the model is prompted to call a tool with one — the
  // compound `where` will silently miss.
  const chatTools =
    portalType === "vendor"
      ? buildVendorChatTools({
          vendorId: vendorId as string,
          userId: session.user.id,
        })
      : buildFacilityChatTools({
          facilityId: facilityId as string,
          userId: session.user.id,
        })

  const systemPrompt =
    portalType === "vendor"
      ? buildVendorSystemPrompt({
          vendorId: vendorId as string,
          vendorName: vendor?.name ?? "your organization",
        })
      : buildFacilitySystemPrompt({
          facilityId: facilityId as string,
          facilityName: facility?.name ?? "your facility",
        })

  // Capture the last user message for a human-readable description.
  // AI SDK v6 `useChat` may send only `parts` (no `content`). Fall back
  // to the first text part when `content` is absent.
  const lastUserMessage = [...messages]
    .reverse()
    .find((m) => m.role === "user")
  let userText = ""
  if (typeof lastUserMessage?.content === "string") {
    userText = lastUserMessage.content
  } else if (Array.isArray(lastUserMessage?.parts)) {
    const firstText = lastUserMessage.parts.find(
      (p): p is { type: string; text?: unknown } =>
        typeof p === "object" && p !== null && (p as { type?: unknown }).type === "text",
    )
    if (firstText && typeof (firstText as { text?: unknown }).text === "string") {
      userText = (firstText as { text: string }).text
    }
  }
  const description = userText
    ? `AI chat — ${userText.slice(0, 60)}`
    : "AI chat question"

  const result = streamText({
    model: claudeModel,
    system: systemPrompt,
    messages: await convertToModelMessages(messages as UIMessage[]),
    tools: chatTools,
    stopWhen: stepCountIs(5),
    onFinish: () => {
      // Fire-and-forget; never await on the user-visible stream path.
      recordClaudeUsage({
        facilityId,
        vendorId,
        userId: session.user.id,
        userName: session.user.name ?? session.user.email ?? "Unknown",
        action: "ai_chat_question",
        description,
      }).catch((err) => {
        console.error("[ai/chat] usage-record failed", err, {
          facilityId,
          vendorId,
          userId: session.user.id,
        })
      })
    },
  })

  return result.toUIMessageStreamResponse()
}
