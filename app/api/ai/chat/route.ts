import {
  streamText,
  convertToModelMessages,
  stepCountIs,
  type UIMessage,
} from "ai"
import { z } from "zod"
import { headers } from "next/headers"
import { auth } from "@/lib/auth-server"
import { geminiModel } from "@/lib/ai/config"
import { chatTools } from "@/lib/ai/tools"
import { facilitySystemPrompt, vendorSystemPrompt } from "@/lib/ai/prompts"
import { rateLimit } from "@/lib/rate-limit"

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

  const result = streamText({
    model: geminiModel,
    system: systemPrompt,
    messages: await convertToModelMessages(messages as UIMessage[]),
    tools: chatTools,
    stopWhen: stepCountIs(5),
  })

  return result.toUIMessageStreamResponse()
}
