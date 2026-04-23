"use client"

import { useState, useRef, useEffect, type FormEvent } from "react"
import {
  Bot, Send, Loader2, Sparkles, MessageSquare, FileText, TrendingUp,
  DollarSign, PieChart, Plus, Copy, Clock, Target, Handshake, BarChart,
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

const VENDOR_SUGGESTED_QUESTIONS: ReadonlyArray<{
  icon: React.ComponentType<{ className?: string }>
  label: string
  question: string
}> = [
  { icon: PieChart, label: "Market Share", question: "What's my market share at each facility?" },
  { icon: Clock, label: "Expiring Contracts", question: "Which contracts are expiring in the next 90 days?" },
  { icon: DollarSign, label: "Pricing Benchmarks", question: "How does my pricing compare to market benchmarks?" },
  { icon: Target, label: "Spend Targets", question: "What spend targets should I focus on to hit the next tier?" },
  { icon: TrendingUp, label: "Growth Opportunities", question: "Where are the biggest opportunities to grow my business?" },
  { icon: Handshake, label: "Facility Relationships", question: "How are my facility relationships performing compared to last quarter?" },
]

interface MessagePart {
  type: string
  text?: string
  [key: string]: unknown
}

function ChatMessageBubble({
  role, parts, onCopy,
}: {
  role: string
  parts: MessagePart[]
  onCopy?: (text: string) => void
}) {
  const isUser = role === "user"
  const textContent = parts.filter((p) => p.type === "text").map((p) => p.text ?? "").join("")
  if (!textContent) return null

  return (
    <div className={`group flex gap-3 ${isUser ? "justify-end" : "justify-start"}`}>
      {!isUser && (
        <Avatar className="size-8 shrink-0">
          <AvatarFallback className="bg-primary/10"><Bot className="size-4 text-primary" /></AvatarFallback>
        </Avatar>
      )}
      <div className="flex flex-col gap-1 max-w-[80%]">
        <div className={`rounded-lg px-4 py-2.5 text-sm ${isUser ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
          <div className="whitespace-pre-wrap leading-relaxed">{textContent}</div>
        </div>
        {!isUser && onCopy && (
          <div className="opacity-0 group-hover:opacity-100 transition-opacity">
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onCopy(textContent)} aria-label="Copy response">
              <Copy className="h-3 w-3" />
            </Button>
          </div>
        )}
      </div>
      {isUser && (
        <Avatar className="size-8 shrink-0">
          <AvatarFallback className="bg-secondary"><MessageSquare className="size-4" /></AvatarFallback>
        </Avatar>
      )}
    </div>
  )
}

function ThinkingBubble() {
  return (
    <div className="flex gap-3 justify-start">
      <Avatar className="size-8 shrink-0">
        <AvatarFallback className="bg-primary/10"><Bot className="size-4 text-primary" /></AvatarFallback>
      </Avatar>
      <div className="rounded-lg bg-muted px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="flex gap-1">
            <span className="size-2 rounded-full bg-primary/60 animate-bounce [animation-delay:0ms]" />
            <span className="size-2 rounded-full bg-primary/60 animate-bounce [animation-delay:150ms]" />
            <span className="size-2 rounded-full bg-primary/60 animate-bounce [animation-delay:300ms]" />
          </span>
          <span className="text-sm text-muted-foreground">Analyzing your data...</span>
        </div>
      </div>
    </div>
  )
}

function EmptyStatePlaceholder({ icon: Icon, title, body }: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  body: string
}) {
  return (
    <Card>
      <CardContent className="py-16">
        <div className="flex flex-col items-center justify-center text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-muted mb-4">
            <Icon className="h-6 w-6 text-muted-foreground" />
          </div>
          <h3 className="text-base font-semibold mb-1">{title}</h3>
          <p className="text-sm text-muted-foreground max-w-sm">{body}</p>
        </div>
      </CardContent>
    </Card>
  )
}

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

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages])

  useEffect(() => {
    if (inputRef.current && activeTab === "chat") inputRef.current.focus()
  }, [activeTab])

  function onChatSubmit(e: FormEvent) {
    e.preventDefault()
    if (!chatInput.trim() || isLoading) return
    void sendMessage({ text: chatInput })
    setChatInput("")
  }

  function handleSuggestion(question: string) {
    if (isLoading) return
    setActiveTab("chat")
    void sendMessage({ text: question })
  }

  function handleReset() {
    setMessages([])
    setChatInput("")
  }

  function handleCopy(text: string) {
    void navigator.clipboard.writeText(text)
  }

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] gap-4">
      {/* Header banner — theme vocabulary */}
      <section className="rounded-xl border bg-card p-6 shadow-sm sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
              <Bot className="h-3.5 w-3.5" />
              AI Assistant
            </div>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">AI Vendor Assistant</h1>
            <p className="text-sm text-muted-foreground">
              Claude Opus 4.6 — contracts, market share, pricing benchmarks, and growth across your facility accounts.
            </p>
          </div>
          {activeTab === "chat" && !isEmpty && (
            <Button variant="outline" size="sm" onClick={handleReset}>
              <Plus className="mr-2 h-4 w-4" />
              New Chat
            </Button>
          )}
        </div>
      </section>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
        <TabsList className="w-fit mb-4">
          <TabsTrigger value="chat" className="gap-2"><MessageSquare className="h-4 w-4" />Chat</TabsTrigger>
          <TabsTrigger value="documents" className="gap-2"><FileText className="h-4 w-4" />Documents</TabsTrigger>
          <TabsTrigger value="reports" className="gap-2"><BarChart className="h-4 w-4" />Reports</TabsTrigger>
        </TabsList>

        <TabsContent value="chat" className="flex-1 flex flex-col overflow-hidden mt-0">
          <Card className="flex flex-1 flex-col overflow-hidden">
            <ScrollArea className="flex-1 p-4" ref={scrollRef}>
              {isEmpty ? (
                <div className="flex flex-col items-center justify-center h-full py-12">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 mb-4">
                    <Sparkles className="h-8 w-8 text-primary" />
                  </div>
                  <h2 className="text-xl font-semibold mb-2">How can I help you today?</h2>
                  <p className="text-muted-foreground text-center max-w-md mb-8">
                    I can analyze your contracts, track market share, review pricing benchmarks, and identify growth opportunities across your facility accounts.
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 w-full max-w-3xl">
                    {VENDOR_SUGGESTED_QUESTIONS.map((sq) => (
                      <button
                        key={sq.label}
                        type="button"
                        onClick={() => handleSuggestion(sq.question)}
                        disabled={isLoading}
                        className="flex h-auto w-full flex-col items-start gap-2 rounded-lg border bg-card p-4 text-left transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
                      >
                        <div className="flex w-full items-center gap-2">
                          <sq.icon className="h-4 w-4 shrink-0 text-primary" />
                          <span className="truncate text-sm font-medium">{sq.label}</span>
                        </div>
                        <p className="line-clamp-2 w-full text-xs leading-relaxed text-muted-foreground">
                          {sq.question}
                        </p>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {messages.map((m) => (
                    <ChatMessageBubble
                      key={m.id}
                      role={m.role}
                      parts={(m.parts as MessagePart[] | undefined) ?? []}
                      onCopy={handleCopy}
                    />
                  ))}
                  {isLoading && <ThinkingBubble />}
                </div>
              )}
            </ScrollArea>

            <Separator />

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
                <Button type="submit" size="icon" disabled={isLoading || !chatInput.trim()} className="shrink-0 h-[44px] w-[44px]">
                  {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </Button>
              </form>
              <p className="text-xs text-muted-foreground mt-2 text-center">
                AI responses are based on shared contract data and may require verification
              </p>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="documents" className="flex-1 overflow-auto mt-0">
          <EmptyStatePlaceholder
            icon={FileText}
            title="Documents"
            body="Coming soon — upload contracts, spec sheets, and reference material for the AI assistant to analyze."
          />
        </TabsContent>

        <TabsContent value="reports" className="flex-1 overflow-auto mt-0">
          <EmptyStatePlaceholder
            icon={BarChart}
            title="Reports"
            body="Coming soon — AI-generated reports on market share, renewals, and performance will appear here."
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}
