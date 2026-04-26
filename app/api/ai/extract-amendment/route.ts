import { generateText } from "ai"
import {
  generateStructured,
  withCacheControl,
} from "@/lib/ai/generate-structured"
import { headers } from "next/headers"
import { z } from "zod"
import { auth } from "@/lib/auth-server"
import { claudeModel } from "@/lib/ai/config"
import { prisma } from "@/lib/db"
import { uploadFile } from "@/lib/storage"
import { rateLimit } from "@/lib/rate-limit"
import { recordClaudeUsage } from "@/lib/ai/record-usage"

// ─── Types ──────────────────────────────────────────────────────

const amendmentChangeSchema = z.object({
  field: z.string(),
  label: z.string(),
  oldValue: z.string(),
  newValue: z.string(),
  type: z.enum(["modified", "added", "removed"]),
})

const extractedAmendmentSchema = z.object({
  effectiveDate: z.string().nullable(),
  changes: z.array(amendmentChangeSchema),
})

export type AmendmentChange = z.infer<typeof amendmentChangeSchema>
export type ExtractedAmendment = z.infer<typeof extractedAmendmentSchema>

// ─── Handler ────────────────────────────────────────────────────

export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session) {
      return Response.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { success, retryAfterMs } = rateLimit(
      `ai-amendment:${session.user.id}`,
      10,
      60_000
    )
    if (!success) {
      return Response.json(
        { error: "Too many requests", retryAfter: Math.ceil(retryAfterMs / 1000) },
        { status: 429 }
      )
    }

    const formData = await request.formData()
    const file = formData.get("file") as File | null
    const contractId = formData.get("contractId") as string | null

    if (!file) {
      return Response.json({ error: "No file provided" }, { status: 400 })
    }
    if (!contractId) {
      return Response.json({ error: "No contractId provided" }, { status: 400 })
    }

    // ── Fetch current contract with terms + tiers ──────────────
    const contract = await prisma.contract.findUnique({
      where: { id: contractId },
      include: {
        vendor: { select: { name: true } },
        productCategory: { select: { name: true } },
        terms: {
          include: { tiers: { orderBy: { tierNumber: "asc" } } },
          orderBy: { createdAt: "asc" },
        },
      },
    })

    if (!contract) {
      return Response.json({ error: "Contract not found" }, { status: 404 })
    }

    // ── Upload amendment file to S3 ────────────────────────────
    const arrayBuffer = await file.arrayBuffer()
    const fileData = new Uint8Array(arrayBuffer)
    const userId = session.user.id
    const timestamp = Date.now()
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_")
    const s3Key = `amendments/${userId}/${timestamp}-${safeName}`
    await uploadFile(s3Key, fileData, file.type || "application/octet-stream")

    const isPDF = file.type === "application/pdf" || file.name.endsWith(".pdf")
    const mediaType = isPDF ? "application/pdf" : "text/plain"

    // ── Build a summary of the current contract for diffing ────
    const currentSummary = buildContractSummary(contract)

    // ── Step 1: Read the amendment document ────────────────────
    const extraction = await generateText({
      model: claudeModel,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Read this contract amendment document carefully and extract ALL changes, modifications, additions, and removals it specifies. Include:
- Any changed dates (effective date, expiration date)
- Pricing changes (new prices, updated tiers, changed rebate percentages)
- Term modifications (new terms added, terms removed, thresholds changed)
- Value changes (total value, annual value)
- Any other contractual modifications

Return all details as structured text.`,
            },
            {
              type: "file",
              data: fileData,
              mediaType,
              // Cache the PDF for 5min — step 2 below re-uploads
              // overlapping context; ephemeral cache cuts cost.
              ...withCacheControl(),
            },
          ],
        },
      ],
    })

    const amendmentText = extraction.text
    if (!amendmentText) {
      return Response.json(
        { error: "Could not read amendment document" },
        { status: 422 }
      )
    }

    // ── Step 2: Compare against current contract ───────────────
    const result = await generateStructured({
      schema: extractedAmendmentSchema,
      actionName: "extract-amendment",
      messages: [
        {
          role: "user",
          content: `You are comparing a contract amendment against the current contract data. Identify every change the amendment makes.

CURRENT CONTRACT DATA:
${currentSummary}

AMENDMENT CONTENT:
${amendmentText}

For each change, determine:
- "field": a machine-readable field key (e.g., "expirationDate", "totalValue", "term:spend_rebate:tier_1_rebatePercent")
- "label": a human-readable label (e.g., "Expiration Date", "Total Value", "Spend Rebate Tier 1 Rebate %")
- "oldValue": the current value from the contract (as a string)
- "newValue": the new value from the amendment (as a string)
- "type": "modified" if the value changed, "added" if it's a new field/term, "removed" if it's being eliminated

Also extract the amendment's effective date if stated (in YYYY-MM-DD format), or null if not specified.

Return valid JSON only — no markdown fences.`,
        },
      ],
    })

    let extracted: ExtractedAmendment | undefined
    try {
      extracted = result.output
    } catch {
      try {
        const cleaned = (result.text ?? "")
          .replace(/```json\n?/g, "")
          .replace(/```\n?/g, "")
          .trim()
        extracted = extractedAmendmentSchema.parse(JSON.parse(cleaned))
      } catch {
        return Response.json(
          {
            error:
              "Could not parse amendment data — the AI response did not match the expected format.",
          },
          { status: 422 }
        )
      }
    }

    if (!extracted) {
      return Response.json({ error: "No changes extracted" }, { status: 422 })
    }

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
        action: "full_contract_analysis",
        description: `Extracted amendment for ${contract.name.slice(0, 40)}`,
      })
    } catch (err) {
      console.error("[extract-amendment] usage-record failed", err, {
        userId: session.user.id,
      })
    }

    return Response.json({
      changes: extracted.changes,
      effectiveDate: extracted.effectiveDate,
      s3Key,
    })
  } catch (error) {
    console.error("Amendment extraction error:", error)
    return Response.json({ error: "Extraction failed" }, { status: 500 })
  }
}

// ─── Helpers ────────────────────────────────────────────────────

function buildContractSummary(contract: {
  name: string
  contractNumber: string | null
  contractType: string
  status: string
  effectiveDate: Date
  expirationDate: Date
  autoRenewal: boolean
  terminationNoticeDays: number
  totalValue: unknown
  annualValue: unknown
  description: string | null
  gpoAffiliation: string | null
  performancePeriod: string
  rebatePayPeriod: string
  vendor: { name: string }
  productCategory: { name: string } | null
  terms: Array<{
    termName: string
    termType: string
    baselineType: string
    evaluationPeriod: string
    paymentTiming: string
    effectiveStart: Date
    effectiveEnd: Date
    spendBaseline: unknown
    volumeBaseline: number | null
    tiers: Array<{
      tierNumber: number
      spendMin: unknown
      spendMax: unknown
      volumeMin: number | null
      volumeMax: number | null
      rebateType: string
      rebateValue: unknown
    }>
  }>
}): string {
  const lines: string[] = [
    `Contract Name: ${contract.name}`,
    `Contract Number: ${contract.contractNumber ?? "N/A"}`,
    `Vendor: ${contract.vendor.name}`,
    `Category: ${contract.productCategory?.name ?? "N/A"}`,
    `Type: ${contract.contractType}`,
    `Status: ${contract.status}`,
    `Effective Date: ${formatDate(contract.effectiveDate)}`,
    `Expiration Date: ${formatDate(contract.expirationDate)}`,
    `Auto Renewal: ${contract.autoRenewal ? "Yes" : "No"}`,
    `Termination Notice Days: ${contract.terminationNoticeDays}`,
    `Total Value: ${contract.totalValue}`,
    `Annual Value: ${contract.annualValue}`,
    `Description: ${contract.description ?? "N/A"}`,
    `GPO Affiliation: ${contract.gpoAffiliation ?? "N/A"}`,
    `Performance Period: ${contract.performancePeriod}`,
    `Rebate Pay Period: ${contract.rebatePayPeriod}`,
  ]

  if (contract.terms.length > 0) {
    lines.push("", "TERMS:")
    for (const term of contract.terms) {
      lines.push(
        `  Term: ${term.termName} (${term.termType})`,
        `    Baseline Type: ${term.baselineType}`,
        `    Evaluation Period: ${term.evaluationPeriod}`,
        `    Payment Timing: ${term.paymentTiming}`,
        `    Effective: ${formatDate(term.effectiveStart)} - ${formatDate(term.effectiveEnd)}`,
        `    Spend Baseline: ${term.spendBaseline ?? "N/A"}`,
        `    Volume Baseline: ${term.volumeBaseline ?? "N/A"}`
      )
      if (term.tiers.length > 0) {
        lines.push("    Tiers:")
        for (const tier of term.tiers) {
          lines.push(
            `      Tier ${tier.tierNumber}: Spend ${tier.spendMin}-${tier.spendMax ?? "unlimited"}, Volume ${tier.volumeMin ?? "N/A"}-${tier.volumeMax ?? "N/A"}, Rebate Type: ${tier.rebateType}, Value: ${tier.rebateValue ?? "N/A"}`
          )
        }
      }
    }
  }

  return lines.join("\n")
}

function formatDate(d: Date): string {
  return d.toISOString().split("T")[0]
}
