"use client"

import { useState, useRef, useEffect, type FormEvent } from "react"
import {
  Bot,
  Send,
  Loader2,
  Sparkles,
  MessageSquare,
  FileText,
  TrendingUp,
  DollarSign,
  PieChart,
  BarChart3,
  Plus,
  Copy,
  Clock,
  Target,
  Handshake,
  BarChart,
} from "lucide-react"
import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport } from "ai"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VENDOR_SUGGESTED_QUESTIONS = [
  {
    icon: PieChart,
    label: "Market Share",
    question: "What's my market share at each facility?",
  },
  {
    icon: Clock,
    label: "Expiring Contracts",
    question: "Which contracts are expiring in the next 90 days?",
  },
  {
    icon: DollarSign,
    label: "Pricing Benchmarks",
    question: "How does my pricing compare to market benchmarks?",
  },
  {
    icon: Target,
    label: "Spend Targets",
    question: "What spend targets should I focus on to hit the next tier?",
  },
  {
    icon: TrendingUp,
    label: "Growth Opportunities",
    question: "Where are the biggest opportunities to grow my business?",
  },
  {
    icon: Handshake,
    label: "Facility Relationships",
    question: "How are my facility relationships performing compared to last quarter?",
  },
]

const QUICK_ACTIONS = [
  {
    icon: BarChart3,
    label: "Compare pricing across facilities",
  },
  {
    icon: FileText,
    label: "Review upcoming contract renewals",
  },
  {
    icon: PieChart,
    label: "Analyze category market share",
  },
  {
    icon: DollarSign,
    label: "Calculate rebate projections",
  },
]

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface ChatMessageBubbleProps {
  role: string
  parts: Array<{ type: string; text?: string; [key: string]: unknown }>
  isLoading?: boolean
  onCopy?: (text: string) => void
}

function ChatMessageBubble({ role, parts, isLoading, onCopy }: ChatMessageBubbleProps) {
  const isUser = role === "user"
  const textContent = parts
    .filter((p) => p.type === "text")
    .map((p) => p.text ?? "")
    .join("")

  if (isLoading && !isUser) {
    return (
      <div className="flex gap-3 justify-start">
        <Avatar className="size-8 shrink-0">
          <AvatarFallback className="bg-primary/10">
            <Bot className="size-4 text-primary" />
          </AvatarFallback>
        </Avatar>
        <div className="rounded-lg bg-muted px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="flex gap-1">
              <span className="size-2 rounded-full bg-primary/60 animate-bounce [animation-delay:0ms]" />
              <span className="size-2 rounded-full bg-primary/60 animate-bounce [animation-delay:150ms]" />
              <span className="size-2 rounded-full bg-primary/60 animate-bounce [animation-delay:300ms]" />
            </span>
            <span className="text-sm text-muted-foreground">
              Analyzing your data...
            </span>
          </div>
        </div>
      </div>
    )
  }

  if (!textContent) return null

  return (
    <div className={`group flex gap-3 ${isUser ? "justify-end" : "justify-start"}`}>
      {!isUser && (
        <Avatar className="size-8 shrink-0">
          <AvatarFallback className="bg-primary/10">
            <Bot className="size-4 text-primary" />
          </AvatarFallback>
        </Avatar>
      )}
      <div className="flex flex-col gap-1 max-w-[80%]">
        <div
          className={`rounded-lg px-4 py-2.5 text-sm ${
            isUser
              ? "bg-primary text-primary-foreground"
              : "bg-muted"
          }`}
        >
          <div className="whitespace-pre-wrap leading-relaxed">{textContent}</div>
        </div>
        {!isUser && onCopy && (
          <div className="opacity-0 group-hover:opacity-100 transition-opacity">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => onCopy(textContent)}
                  >
                    <Copy className="h-3 w-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Copy response</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        )}
      </div>
      {isUser && (
        <Avatar className="size-8 shrink-0">
          <AvatarFallback className="bg-secondary">
            <MessageSquare className="size-4" />
          </AvatarFallback>
        </Avatar>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface VendorAIAgentClientProps {
  vendorId: string
}

export function VendorAIAgentClient({ vendorId: _vendorId }: VendorAIAgentClientProps) {
  const [activeTab, setActiveTab] = useState("chat")
  const [chatInput, setChatInput] = useState("")
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const { messages, sendMessage, status, setMessages } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/ai/chat",
      body: { portalType: "vendor" },
    }),
  })

  const isLoading = status === "streaming" || status === "submitted"
  const isEmpty = messages.length === 0

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  // Focus input on tab change
  useEffect(() => {
    if (inputRef.current && activeTab === "chat") {
      inputRef.current.focus()
    }
  }, [activeTab])

  function onChatSubmit(e: FormEvent) {
    e.preventDefault()
    if (!chatInput.trim() || isLoading) return
    sendMessage({ text: chatInput })
    setChatInput("")
  }

  function handleSuggestion(question: string) {
    if (isLoading) return
    setActiveTab("chat")
    sendMessage({ text: question })
  }

  function handleReset() {
    setMessages([])
    setChatInput("")
  }

  function handleCopy(text: string) {
    navigator.clipboard.writeText(text)
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
            <h1 className="text-2xl font-bold tracking-tight">AI Vendor Assistant</h1>
            <p className="text-sm text-muted-foreground">
              Ask questions about your contracts, market share, and performance
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {activeTab === "chat" && !isEmpty && (
            <Button variant="outline" size="sm" onClick={handleReset}>
              <Plus className="mr-2 h-4 w-4" />
              New Chat
            </Button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="flex-1 flex flex-col overflow-hidden"
      >
        <TabsList className="w-fit mb-4">
          <TabsTrigger value="chat" className="gap-2">
            <MessageSquare className="h-4 w-4" />
            Chat
          </TabsTrigger>
          <TabsTrigger value="documents" className="gap-2">
            <FileText className="h-4 w-4" />
            Documents
          </TabsTrigger>
          <TabsTrigger value="reports" className="gap-2">
            <BarChart className="h-4 w-4" />
            Reports
          </TabsTrigger>
        </TabsList>

        {/* ================================================================ */}
        {/* Chat Tab                                                         */}
        {/* ================================================================ */}
        <TabsContent
          value="chat"
          className="flex-1 flex flex-col overflow-hidden mt-0"
        >
          <Card className="flex flex-1 flex-col overflow-hidden">
            {/* Chat messages area */}
            <ScrollArea className="flex-1 p-4" ref={scrollRef}>
              {isEmpty ? (
                <div className="flex flex-col items-center justify-center h-full py-12">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 mb-4">
                    <Sparkles className="h-8 w-8 text-primary" />
                  </div>
                  <h2 className="text-xl font-semibold mb-2">
                    How can I help you today?
                  </h2>
                  <p className="text-muted-foreground text-center max-w-md mb-8">
                    I can analyze your contracts, track market share, review
                    pricing benchmarks, and identify growth opportunities across
                    your facility accounts.
                  </p>

                  {/* Suggested questions */}
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 w-full max-w-3xl">
                    {VENDOR_SUGGESTED_QUESTIONS.map((sq) => (
                      <Button
                        key={sq.label}
                        variant="outline"
                        className="h-auto p-4 flex flex-col items-start gap-2 text-left"
                        onClick={() => handleSuggestion(sq.question)}
                      >
                        <div className="flex items-center gap-2">
                          <sq.icon className="h-4 w-4 text-primary" />
                          <span className="font-medium">{sq.label}</span>
                        </div>
                        <span className="text-xs text-muted-foreground line-clamp-2">
                          {sq.question}
                        </span>
                      </Button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {messages.map((m) => (
                    <ChatMessageBubble
                      key={m.id}
                      role={m.role}
                      parts={m.parts}
                      onCopy={handleCopy}
                    />
                  ))}
                  {isLoading && (
                    <ChatMessageBubble
                      role="assistant"
                      parts={[]}
                      isLoading
                    />
                  )}
                </div>
              )}
            </ScrollArea>

            <Separator />

            {/* Input area */}
            <div className="p-4">
              <form onSubmit={onChatSubmit} className="flex gap-2 items-end">
                <Textarea
                  ref={inputRef}
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault()
                      onChatSubmit(e)
                    }
                  }}
                  placeholder="Ask about contracts, market share, pricing..."
                  disabled={isLoading}
                  className="flex-1 min-h-[44px] max-h-[120px] resize-none"
                  rows={1}
                />
                <Button
                  type="submit"
                  size="icon"
                  disabled={isLoading || !chatInput.trim()}
                  className="shrink-0 h-[44px] w-[44px]"
                >
                  {isLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </Button>
              </form>
              <p className="text-xs text-muted-foreground mt-2 text-center">
                AI responses are based on shared contract data and may require
                verification
              </p>
            </div>
          </Card>

          {/* Quick action chips */}
          <div className="mt-4 flex flex-wrap gap-2">
            {QUICK_ACTIONS.map((action) => (
              <Button
                key={action.label}
                variant="secondary"
                size="sm"
                className="h-8 gap-1.5 text-xs"
                onClick={() => handleSuggestion(action.label)}
              >
                <action.icon className="h-3.5 w-3.5" />
                {action.label}
              </Button>
            ))}
          </div>
        </TabsContent>

        {/* ================================================================ */}
        {/* Documents Tab                                                    */}
        {/* ================================================================ */}
        <TabsContent value="documents" className="flex-1 overflow-auto mt-0">
          <Card>
            <CardContent className="py-16">
              <div className="flex flex-col items-center justify-center text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-muted mb-4">
                  <FileText className="h-6 w-6 text-muted-foreground" />
                </div>
                <h3 className="text-base font-semibold mb-1">Documents</h3>
                <p className="text-sm text-muted-foreground max-w-sm">
                  Coming soon — upload contracts, spec sheets, and reference
                  material for the AI assistant to analyze.
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ================================================================ */}
        {/* Reports Tab                                                      */}
        {/* ================================================================ */}
        <TabsContent value="reports" className="flex-1 overflow-auto mt-0">
          <Card>
            <CardContent className="py-16">
              <div className="flex flex-col items-center justify-center text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-muted mb-4">
                  <BarChart className="h-6 w-6 text-muted-foreground" />
                </div>
                <h3 className="text-base font-semibold mb-1">Reports</h3>
                <p className="text-sm text-muted-foreground max-w-sm">
                  Coming soon — AI-generated reports on market share, renewals,
                  and performance will appear here.
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
