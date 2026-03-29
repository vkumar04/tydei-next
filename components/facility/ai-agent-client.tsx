"use client"

import { Lock } from "lucide-react"
import { PageHeader } from "@/components/shared/page-header"
import { ChatInterface } from "@/components/shared/ai/chat-interface"
import { Card, CardContent } from "@/components/ui/card"

interface AIAgentClientProps {
  facilityId: string
  enabled: boolean
}

export function AIAgentClient({ facilityId, enabled }: AIAgentClientProps) {
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
      />
      <ChatInterface portalType="facility" entityId={facilityId} />
    </div>
  )
}
