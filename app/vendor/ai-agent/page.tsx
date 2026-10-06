import { requireVendor } from "@/lib/actions/auth"
import { VendorAIAgentClient } from "@/components/vendor/ai-agent-client"

export const instant = false

export default async function VendorAIAgentPage() {
  const { vendor } = await requireVendor()

  return <VendorAIAgentClient vendorId={vendor.id} />
}
