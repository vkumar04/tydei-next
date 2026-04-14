"use client"

import { useState, useRef, useEffect, type FormEvent } from "react"
import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport } from "ai"
import { Send, Loader2, Sparkles, RefreshCw } from "lucide-react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { ChatMessage } from "@/components/shared/ai/chat-message"
import { SuggestedQuestions } from "@/components/shared/ai/suggested-questions"
import { suggestedQuestions } from "@/lib/ai/prompts"

interface ChatInterfaceProps {
  portalType: "facility" | "vendor"
  entityId: string
}

export function ChatInterface({ portalType }: ChatInterfaceProps) {
  const [input, setInput] = useState("")
  const scrollRef = useRef<HTMLDivElement>(null)

  const { messages, sendMessage, status, setMessages } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/ai/chat",
      body: { portalType },
    }),
  })

  const isLoading = status === "streaming" || status === "submitted"

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!input.trim() || isLoading) return
    sendMessage({ text: input })
    setInput("")
  }

  function handleSuggestion(question: string) {
    if (isLoading) return
    sendMessage({ text: question })
  }

  function handleReset() {
    setMessages([])
  }

  const questions = suggestedQuestions[portalType]
  const isEmpty = messages.length === 0

  return (
    <Card className="flex flex-1 flex-col overflow-hidden">
      {/* Optional reset button when there are messages */}
      {!isEmpty && (
        <div className="flex items-center justify-end border-b px-4 py-2">
          <Button variant="outline" size="sm" onClick={handleReset}>
            <RefreshCw className="mr-2 h-4 w-4" />
            New Chat
          </Button>
        </div>
      )}

      <ScrollArea className="flex-1 p-4" ref={scrollRef}>
        {isEmpty ? (
          <div className="flex flex-col items-center justify-center h-full py-8">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 mb-4">
              <Sparkles className="h-8 w-8 text-primary" />
            </div>
            <h2 className="text-xl font-semibold mb-2">
              How can I help you today?
            </h2>
            <p className="text-muted-foreground text-center max-w-md mb-8">
              I can analyze your contracts, calculate rebates, review surgeon performance,
              and help identify cost-saving opportunities.
            </p>
            <SuggestedQuestions
              questions={[...questions]}
              onSelect={handleSuggestion}
            />
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((m) => (
              <ChatMessage key={m.id} role={m.role} parts={m.parts} />
            ))}
            {isLoading && (
              <ChatMessage
                role="assistant"
                parts={[]}
                isLoading
              />
            )}
          </div>
        )}
      </ScrollArea>

      <Separator />

      <div className="p-4">
        <form onSubmit={onSubmit} className="flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about contracts, rebates, surgeon performance..."
            disabled={isLoading}
            className="flex-1"
          />
          <Button type="submit" disabled={isLoading || !input.trim()}>
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </form>
      </div>

    </Card>
  )
}
