import { prisma } from "@/lib/db"
import { recordClaudeUsage } from "@/lib/ai/record-usage"

export async function recordContractExtractionUsage(
  userId: string,
  userName: string,
  description: string,
  logPrefix: string,
): Promise<void> {
  try {
    const member = await prisma.member.findFirst({
      where: { userId },
      include: { organization: { include: { facility: true, vendor: true } } },
    })
    await recordClaudeUsage({
      facilityId: member?.organization?.facility?.id ?? null,
      vendorId: member?.organization?.vendor?.id ?? null,
      userId,
      userName,
      action: "full_contract_analysis",
      description,
    })
  } catch (err) {
    console.error(`${logPrefix} usage-record failed`, err, { userId })
  }
}
