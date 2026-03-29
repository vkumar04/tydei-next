"use client"

import { Lock, Bot, RefreshCw } from "lucide-react"
import { PageHeader } from "@/components/shared/page-header"
import { ChatInterface } from "@/components/shared/ai/chat-interface"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"

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
    <div className="flex flex-col h-[calc(100vh-8rem)]">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <Bot className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">AI Assistant</h1>
            <p className="text-sm text-muted-foreground">
              Ask questions about your contracts, spending, and rebates
            </p>
          </div>
        </div>
      </div>

      {/* Full-height chat */}
      <ChatInterface portalType="facility" entityId={facilityId} />
    </div>
  )
}
