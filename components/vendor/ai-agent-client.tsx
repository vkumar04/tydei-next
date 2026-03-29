"use client"

import { PageHeader } from "@/components/shared/page-header"
import { ChatInterface } from "@/components/shared/ai/chat-interface"

interface VendorAIAgentClientProps {
  vendorId: string
}

export function VendorAIAgentClient({ vendorId }: VendorAIAgentClientProps) {
  return (
    <div className="space-y-6">
      <PageHeader
        title="AI Agent"
        description="Ask questions about your contracts, market share, and performance"
      />
      <ChatInterface portalType="vendor" entityId={vendorId} />
    </div>
  )
}
