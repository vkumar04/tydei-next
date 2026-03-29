"use client"

import { useState, useRef, useEffect, type FormEvent } from "react"
import { useChat } from "@ai-sdk/react"
import { TextStreamChatTransport } from "ai"
import { Send, Loader2 } from "lucide-react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { ChatMessage } from "@/components/shared/ai/chat-message"
import { SuggestedQuestions } from "@/components/shared/ai/suggested-questions"
import { suggestedQuestions } from "@/lib/ai/prompts"

interface ChatInterfaceProps {
  portalType: "facility" | "vendor"
  entityId: string
}

export function ChatInterface({ portalType, entityId }: ChatInterfaceProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [input, setInput] = useState("")

  const { messages, sendMessage, status } = useChat({
    transport: new TextStreamChatTransport({
      api: "/api/ai/chat",
      body: { portalType, entityId },
    }),
  })

  const isLoading = status === "streaming" || status === "submitted"

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!input.trim() || isLoading) return
    sendMessage({ text: input })
    setInput("")
  }

  function handleSuggestion(question: string) {
    sendMessage({ text: question })
  }

  const questions = suggestedQuestions[portalType]
  const isEmpty = messages.length === 0

  return (
    <Card className="flex h-[600px] flex-col">
      <ScrollArea ref={scrollRef} className="flex-1 p-4">
        {isEmpty ? (
          <div className="flex h-full flex-col items-center justify-center gap-6 py-16">
            <p className="text-sm text-muted-foreground">
              Ask a question about your contracts, spending, or rebates
            </p>
            <SuggestedQuestions
              questions={[...questions]}
              onSelect={handleSuggestion}
            />
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((m) => (
              <ChatMessage
                key={m.id}
                message={m}
                isUser={m.role === "user"}
              />
            ))}
            {isLoading && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Thinking...
              </div>
            )}
          </div>
        )}
      </ScrollArea>

      <form
        onSubmit={handleSubmit}
        className="flex items-center gap-2 border-t p-4"
      >
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about contracts, spending, rebates..."
          disabled={isLoading}
          className="flex-1"
        />
        <Button type="submit" size="icon" disabled={isLoading || !input.trim()}>
          <Send className="size-4" />
        </Button>
      </form>
    </Card>
  )
}
