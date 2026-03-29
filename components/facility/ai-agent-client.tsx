"use client"

import { Bot, Lock } from "lucide-react"
import { PageHeader } from "@/components/shared/page-header"
import { ChatInterface } from "@/components/shared/ai/chat-interface"
import { CreditIndicator } from "@/components/shared/ai/credit-indicator"
import { Card, CardContent } from "@/components/ui/card"
import { useCredits, useCreditGuard } from "@/hooks/use-ai-credits"

interface AIAgentClientProps {
  facilityId: string
  enabled: boolean
}

export function AIAgentClient({ facilityId, enabled }: AIAgentClientProps) {
  const { data: credits } = useCredits(facilityId, "facility")
  const { isEmpty } = useCreditGuard(credits)

  if (!enabled) {
    return (
      <div className="space-y-6">
        <PageHeader title="AI Agent" description="AI-powered contract analysis" />
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12">
            <Lock className="size-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              AI Agent is disabled. Enable it in Settings.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="AI Agent"
        description="Ask questions about your contracts, spending, and rebates"
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
        <ChatInterface portalType="facility" entityId={facilityId} />
      )}
    </div>
  )
}
