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
import { chatTools } from "@/lib/ai/tools"
import { facilitySystemPrompt, vendorSystemPrompt } from "@/lib/ai/prompts"
import { rateLimit } from "@/lib/rate-limit"
import { prisma } from "@/lib/db"
import { recordClaudeUsage } from "@/lib/ai/record-usage"

const chatBodySchema = z.object({
  messages: z.array(z.object({
    id: z.string(),
    role: z.enum(["user", "assistant", "system"]),
    content: z.string(),
    parts: z.array(z.any()).optional(),
  }).passthrough()),
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

  const systemPrompt =
    portalType === "vendor" ? vendorSystemPrompt : facilitySystemPrompt

  // Resolve the owning entity (facility or vendor) for usage attribution.
  // Best-effort: if membership isn't resolvable, the usage recorder silently
  // no-ops on the record side.
  const member = await prisma.member.findFirst({
    where: { userId: session.user.id },
    include: {
      organization: { include: { facility: true, vendor: true } },
    },
  })
  const facilityId = member?.organization?.facility?.id ?? null
  const vendorId = member?.organization?.vendor?.id ?? null

  // Capture the last user message for a human-readable description.
  const lastUserMessage = [...messages]
    .reverse()
    .find((m) => m.role === "user")
  const userText =
    typeof lastUserMessage?.content === "string"
      ? lastUserMessage.content
      : ""
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
