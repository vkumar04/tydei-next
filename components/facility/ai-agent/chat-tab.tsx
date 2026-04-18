"use client"

/**
 * Chat tab for `/dashboard/ai-agent`.
 *
 * Wires `@ai-sdk/react`'s `useChat` to `/api/ai/chat`, which uses
 * `streamText` with Claude Opus 4.6 + facility-scoped tool calls.
 *
 * Shows the 6 canonical suggested-question chips when empty
 * (`FACILITY_SUGGESTED_QUESTIONS` from `lib/ai/chat-suggestions`) and
 * the "New Chat" action when a conversation is underway.
 */

import { useRef, useEffect, useState, type FormEvent } from "react"
import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport } from "ai"
import {
  Bot,
  Send,
  Loader2,
  Sparkles,
  MessageSquare,
  Plus,
  Copy,
  FileText,
  TrendingUp,
  AlertTriangle,
  DollarSign,
  PieChart,
  BarChart3,
} from "lucide-react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { FACILITY_SUGGESTED_QUESTIONS } from "@/lib/ai/chat-suggestions"

// Icon mapping for the 6 canonical categories (spec §2).
const CATEGORY_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  "Contract Performance": FileText,
  "Rebate Analysis": TrendingUp,
  "Alerts Summary": AlertTriangle,
  "Cost Savings": DollarSign,
  "Market Share": PieChart,
  "Surgeon Metrics": BarChart3,
}

interface MessagePart {
  type: string
  text?: string
  [key: string]: unknown
}

interface ChatMessage {
  id: string
  role: string
  parts: MessagePart[]
}

interface ChatMessageBubbleProps {
  message: ChatMessage
  onCopy: (text: string) => void
}

function ChatMessageBubble({ message, onCopy }: ChatMessageBubbleProps) {
  const isUser = message.role === "user"
  const textContent = message.parts
    .filter((p) => p.type === "text")
    .map((p) => p.text ?? "")
    .join("")

  if (!textContent) return null

  return (
    <div
      className={`group flex gap-3 ${isUser ? "justify-end" : "justify-start"}`}
    >
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
            isUser ? "bg-primary text-primary-foreground" : "bg-muted"
          }`}
        >
          <div className="whitespace-pre-wrap leading-relaxed">{textContent}</div>
        </div>
        {!isUser && (
          <div className="opacity-0 group-hover:opacity-100 transition-opacity">
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => onCopy(textContent)}
              aria-label="Copy response"
            >
              <Copy className="h-3 w-3" />
            </Button>
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

function ThinkingBubble() {
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

export function ChatTab() {
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const [chatInput, setChatInput] = useState("")

  const { messages, sendMessage, status, setMessages } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/ai/chat",
      body: { portalType: "facility" },
    }),
  })

  const isLoading = status === "streaming" || status === "submitted"
  const isEmpty = messages.length === 0

  // Auto-scroll to bottom as the assistant streams.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!chatInput.trim() || isLoading) return
    void sendMessage({ text: chatInput })
    setChatInput("")
  }

  function handleSuggestion(question: string) {
    if (isLoading) return
    void sendMessage({ text: question })
  }

  function handleReset() {
    setMessages([])
    setChatInput("")
    inputRef.current?.focus()
  }

  function handleCopy(text: string) {
    void navigator.clipboard.writeText(text)
  }

  return (
    <div className="flex flex-col h-full">
      {!isEmpty && (
        <div className="mb-3 flex justify-end">
          <Button variant="outline" size="sm" onClick={handleReset}>
            <Plus className="mr-2 h-4 w-4" />
            New Chat
          </Button>
        </div>
      )}

      <Card className="flex flex-1 flex-col overflow-hidden">
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
                I can analyze your contracts, calculate rebates, review surgeon
                performance, and help identify cost-saving opportunities.
              </p>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 w-full max-w-3xl">
                {FACILITY_SUGGESTED_QUESTIONS.map((sq) => {
                  const Icon = CATEGORY_ICONS[sq.category] ?? Sparkles
                  return (
                    <Button
                      key={sq.category}
                      variant="outline"
                      className="h-auto p-4 flex flex-col items-start gap-2 text-left"
                      onClick={() => handleSuggestion(sq.question)}
                    >
                      <div className="flex items-center gap-2">
                        <Icon className="h-4 w-4 text-primary" />
                        <span className="font-medium">{sq.category}</span>
                      </div>
                      <span className="text-xs text-muted-foreground line-clamp-2">
                        {sq.question}
                      </span>
                    </Button>
                  )
                })}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {messages.map((m) => (
                <ChatMessageBubble
                  key={m.id}
                  message={{
                    id: m.id,
                    role: m.role,
                    parts: (m.parts as MessagePart[] | undefined) ?? [],
                  }}
                  onCopy={handleCopy}
                />
              ))}
              {isLoading && <ThinkingBubble />}
            </div>
          )}
        </ScrollArea>

        <Separator />

        <div className="p-4">
          <form onSubmit={handleSubmit} className="flex gap-2 items-end">
            <Textarea
              ref={inputRef}
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault()
                  handleSubmit(e)
                }
              }}
              placeholder="Ask about contracts, rebates, surgeon performance..."
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
            AI responses are based on your contract data and may require
            verification
          </p>
        </div>
      </Card>

      <div className="mt-4 flex flex-wrap gap-2">
        <Badge variant="secondary">Contract Analysis</Badge>
        <Badge variant="secondary">Rebate Calculations</Badge>
        <Badge variant="secondary">Market Share</Badge>
        <Badge variant="secondary">Surgeon Metrics</Badge>
        <Badge variant="secondary">Alerts Review</Badge>
        <Badge variant="secondary">Cost Optimization</Badge>
      </div>
    </div>
  )
}
