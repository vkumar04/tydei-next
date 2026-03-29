"use client"

import { Bot, User, Loader2 } from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"

interface ChatMessageProps {
  role: string
  parts: Array<{ type: string; text?: string; [key: string]: unknown }>
  isLoading?: boolean
}

export function ChatMessage({ role, parts, isLoading }: ChatMessageProps) {
  const isUser = role === "user"
  const textContent = parts
    .filter((p) => p.type === "text")
    .map((p) => p.text ?? "")
    .join("")

  // Loading / typing indicator for assistant
  if (isLoading && !isUser) {
    return (
      <div className="flex gap-3 justify-start">
        <Avatar className="size-8 shrink-0">
          <AvatarFallback className="bg-primary/10">
            <Bot className="size-4 text-primary" />
          </AvatarFallback>
        </Avatar>
        <div className="rounded-lg bg-muted px-4 py-2">
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm text-muted-foreground">Analyzing...</span>
          </div>
        </div>
      </div>
    )
  }

  if (!textContent) return null

  return (
    <div className={`flex gap-3 ${isUser ? "justify-end" : "justify-start"}`}>
      {!isUser && (
        <Avatar className="size-8 shrink-0">
          <AvatarFallback className="bg-primary/10">
            <Bot className="size-4 text-primary" />
          </AvatarFallback>
        </Avatar>
      )}
      <div
        className={`max-w-[80%] rounded-lg px-4 py-2 text-sm ${
          isUser ? "bg-primary text-primary-foreground" : "bg-muted"
        }`}
      >
        <div className="whitespace-pre-wrap">{textContent}</div>
      </div>
      {isUser && (
        <Avatar className="size-8 shrink-0">
          <AvatarFallback className="bg-secondary">
            <User className="size-4" />
          </AvatarFallback>
        </Avatar>
      )}
    </div>
  )
}
