"use client"

import { Bot } from "lucide-react"
import { PageHeader } from "@/components/shared/page-header"
import { ChatInterface } from "@/components/shared/ai/chat-interface"
import { CreditIndicator } from "@/components/shared/ai/credit-indicator"
import { Card, CardContent } from "@/components/ui/card"
import { useCredits, useCreditGuard } from "@/hooks/use-ai-credits"

interface VendorAIAgentClientProps {
  vendorId: string
}

export function VendorAIAgentClient({ vendorId }: VendorAIAgentClientProps) {
  const { data: credits } = useCredits(vendorId, "vendor")
  const { isEmpty } = useCreditGuard(credits)

  return (
    <div className="space-y-6">
      <PageHeader
        title="AI Agent"
        description="Ask questions about your contracts, market share, and performance"
        action={
          credits ? (
            <CreditIndicator
              remaining={credits.remaining}
              total={credits.monthlyCredits + credits.rolloverCredits}
              tier={credits.tierId}
            />
          ) : undefined
        }
      />

      {isEmpty ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12">
            <Bot className="size-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              No AI credits remaining. Upgrade your plan to continue.
            </p>
          </CardContent>
        </Card>
      ) : (
        <ChatInterface portalType="vendor" entityId={vendorId} />
      )}
    </div>
  )
}
