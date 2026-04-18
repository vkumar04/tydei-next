"use client"

/**
 * Root client for `/dashboard/ai-agent`. Renders three tabs:
 *
 *   1. Chat       — streaming chat via `/api/ai/chat` (Claude Opus 4.6)
 *   2. Documents  — list / search / upload indexed contract docs
 *   3. Reports    — structured report generation via `/api/ai/generate-report`
 *
 * Data flow is strictly UI / route / server-action. Server actions in
 * `lib/actions/ai/*` are untouched; route handlers in `app/api/ai/*`
 * are thin wrappers over those actions plus auth + rate limiting.
 */

import { useState } from "react"
import {
  Bot,
  Lock,
  MessageSquare,
  Search,
  ClipboardList,
} from "lucide-react"
import {
  Card,
  CardContent,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ChatTab } from "./chat-tab"
import { DocumentsTab } from "./documents-tab"
import { ReportsTab } from "./reports-tab"

export interface AIAgentContractOption {
  id: string
  name: string
}

export interface AIAgentClientProps {
  facilityId: string
  enabled: boolean
  contracts: AIAgentContractOption[]
}

export function AIAgentClient({
  enabled,
  contracts,
}: AIAgentClientProps) {
  const [activeTab, setActiveTab] = useState<"chat" | "documents" | "reports">(
    "chat",
  )

  if (!enabled) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <Bot className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">AI Assistant</h1>
            <p className="text-sm text-muted-foreground">
              AI-powered contract analysis
            </p>
          </div>
        </div>
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-16">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
              <Lock className="size-8 text-muted-foreground" />
            </div>
            <div className="text-center space-y-2">
              <h3 className="text-lg font-semibold">AI Agent is Disabled</h3>
              <p className="text-sm text-muted-foreground max-w-md">
                The AI assistant can analyze contracts, calculate rebates,
                review surgeon performance, and help identify cost-saving
                opportunities. Enable it in facility settings to get started.
              </p>
            </div>
            <Button variant="outline" className="mt-2">
              Go to Settings
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)]">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <Bot className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">AI Assistant</h1>
            <p className="text-sm text-muted-foreground">
              Chat, search documents, or generate reports powered by Claude
              Opus 4.6
            </p>
          </div>
        </div>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(v) =>
          setActiveTab(v as "chat" | "documents" | "reports")
        }
        className="flex-1 flex flex-col overflow-hidden"
      >
        <TabsList className="w-fit mb-4">
          <TabsTrigger value="chat" className="gap-2">
            <MessageSquare className="h-4 w-4" />
            Chat
          </TabsTrigger>
          <TabsTrigger value="documents" className="gap-2">
            <Search className="h-4 w-4" />
            Documents
          </TabsTrigger>
          <TabsTrigger value="reports" className="gap-2">
            <ClipboardList className="h-4 w-4" />
            Reports
          </TabsTrigger>
        </TabsList>

        <TabsContent
          value="chat"
          className="flex-1 flex flex-col overflow-hidden mt-0"
        >
          <ChatTab />
        </TabsContent>

        <TabsContent value="documents" className="flex-1 overflow-auto mt-0">
          <DocumentsTab contracts={contracts} />
        </TabsContent>

        <TabsContent value="reports" className="flex-1 overflow-auto mt-0">
          <ReportsTab contracts={contracts} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
