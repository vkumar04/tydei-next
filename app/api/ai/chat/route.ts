import { streamText, stepCountIs } from "ai"
import { geminiModel } from "@/lib/ai/config"
import { chatTools } from "@/lib/ai/tools"
import { facilitySystemPrompt, vendorSystemPrompt } from "@/lib/ai/prompts"

export async function POST(request: Request) {
  const { messages, portalType } = await request.json()

  const systemPrompt =
    portalType === "vendor" ? vendorSystemPrompt : facilitySystemPrompt

  const result = streamText({
    model: geminiModel,
    system: systemPrompt,
    messages,
    tools: chatTools,
    stopWhen: stepCountIs(5),
  })

  return result.toTextStreamResponse()
}
