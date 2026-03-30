"use client"

import { useState } from "react"
import { Lock, Bot, RefreshCw, Upload, Search, MessageSquare, ClipboardList } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { ChatInterface } from "@/components/shared/ai/chat-interface"

interface AIAgentClientProps {
  facilityId: string
  enabled: boolean
}

export function AIAgentClient({ facilityId, enabled }: AIAgentClientProps) {
  const [activeTab, setActiveTab] = useState("chat")

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
              Chat with AI or search your contract documents
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {activeTab === "documents" && (
            <Button variant="outline" size="sm">
              <Upload className="mr-2 h-4 w-4" />
              Upload Document
            </Button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
        <TabsList className="w-fit mb-4">
          <TabsTrigger value="chat" className="gap-2">
            <MessageSquare className="h-4 w-4" />
            Chat
          </TabsTrigger>
          <TabsTrigger value="documents" className="gap-2">
            <Search className="h-4 w-4" />
            Document Search
          </TabsTrigger>
          <TabsTrigger value="reports" className="gap-2">
            <ClipboardList className="h-4 w-4" />
            Generate Reports
          </TabsTrigger>
        </TabsList>

        {/* Chat Tab */}
        <TabsContent value="chat" className="flex-1 flex flex-col overflow-hidden mt-0">
          <ChatInterface portalType="facility" entityId={facilityId} />

          <div className="mt-4 flex flex-wrap gap-2">
            <Badge variant="secondary">Contract Analysis</Badge>
            <Badge variant="secondary">Rebate Calculations</Badge>
            <Badge variant="secondary">Market Share</Badge>
            <Badge variant="secondary">Surgeon Metrics</Badge>
            <Badge variant="secondary">Alerts Review</Badge>
            <Badge variant="secondary">Cost Optimization</Badge>
          </div>
        </TabsContent>

        {/* Documents Tab */}
        <TabsContent value="documents" className="flex-1 overflow-auto mt-0">
          <div className="space-y-4">
            <Card>
              <CardContent className="pt-6">
                <div className="space-y-4">
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        placeholder="Search contract terms, clauses, pricing..."
                        className="pl-9 pr-4"
                      />
                    </div>
                    <Button>
                      <Search className="mr-2 h-4 w-4" />
                      Search
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="py-12">
                <div className="text-center">
                  <Search className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <h3 className="text-lg font-medium mb-2">Search Your Documents</h3>
                  <p className="text-muted-foreground mb-4">
                    Enter a search term to find specific clauses, terms, and pricing across all indexed documents
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Reports Tab */}
        <TabsContent value="reports" className="flex-1 overflow-auto mt-0">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ClipboardList className="h-5 w-5 text-primary" />
                AI Report Generator
              </CardTitle>
              <CardDescription>
                Describe the report you need and AI will generate it in professional format
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
                <ClipboardList className="h-12 w-12 mb-4 opacity-50" />
                <p>No report generated yet</p>
                <p className="text-sm">Describe your report and click Generate</p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
