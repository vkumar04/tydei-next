import { generateText, Output } from "ai"
import { z } from "zod"
import { headers } from "next/headers"
import { auth } from "@/lib/auth-server"
import { claudeModel } from "@/lib/ai/config"
import { supplyMatchSchema } from "@/lib/ai/schemas"
import { rateLimit } from "@/lib/rate-limit"
import { prisma } from "@/lib/db"
import { recordClaudeUsage } from "@/lib/ai/record-usage"

const matchBodySchema = z.object({
  supplyName: z.string().min(1).max(500),
  vendorItemNo: z.string().max(100).optional(),
  contractPricing: z.array(z.object({
    vendorItemNo: z.string(),
    description: z.string().optional(),
    unitPrice: z.number(),
  }).passthrough()).max(200),
})

export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session) {
      return Response.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { success, retryAfterMs } = rateLimit(`ai-match:${session.user.id}`, 20, 60_000)
    if (!success) {
      return Response.json(
        { error: "Too many requests", retryAfter: Math.ceil(retryAfterMs / 1000) },
        { status: 429 }
      )
    }

    const parsed = matchBodySchema.safeParse(await request.json())
    if (!parsed.success) {
      return Response.json({ error: "Invalid request body" }, { status: 400 })
    }
    const { supplyName, vendorItemNo, contractPricing } = parsed.data

    const pricingContext = contractPricing
      .slice(0, 50)
      .map(
        (p: { vendorItemNo: string; description?: string; unitPrice: number }) =>
          `${p.vendorItemNo} — ${p.description ?? "N/A"} ($${p.unitPrice})`
      )
      .join("\n")

    const result = await generateText({
      model: claudeModel,
      output: Output.object({ schema: supplyMatchSchema }),
      prompt: `Match this surgical supply to the closest item in the contract pricing list.

Supply to match:
- Material Name: ${supplyName}
- Vendor Item No: ${vendorItemNo ?? "Unknown"}

Contract Pricing Items:
${pricingContext}

If no reasonable match exists (confidence < 0.3), return null for matchedVendorItemNo and matchedDescription.
Explain your reasoning for the match or lack thereof.`,
    })

    try {
      const member = await prisma.member.findFirst({
        where: { userId: session.user.id },
        include: {
          organization: { include: { facility: true, vendor: true } },
        },
      })
      await recordClaudeUsage({
        facilityId: member?.organization?.facility?.id ?? null,
        vendorId: member?.organization?.vendor?.id ?? null,
        userId: session.user.id,
        userName: session.user.name ?? session.user.email ?? "Unknown",
        action: "supply_matching",
        description: `Supply match: ${supplyName.slice(0, 50)}`,
      })
    } catch (err) {
      console.error("[match-supplies] usage-record failed", err, {
        userId: session.user.id,
      })
    }

    return Response.json(result.output)
  } catch (error) {
    console.error("Supply matching error:", error)
    return Response.json({ error: "Matching failed" }, { status: 500 })
  }
}
