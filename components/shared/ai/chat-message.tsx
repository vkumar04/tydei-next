"use client"

import { Bot, User } from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"

interface ChatMessageProps {
  role: string
  parts: Array<{ type: string; text?: string; [key: string]: unknown }>
}

export function ChatMessage({ role, parts }: ChatMessageProps) {
  const isUser = role === "user"
  const textContent = parts
    .filter((p) => p.type === "text")
    .map((p) => p.text ?? "")
    .join("")

  if (!textContent) return null

  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""}`}>
      <Avatar className="size-8 shrink-0">
        <AvatarFallback
          className={
            isUser ? "bg-primary text-primary-foreground" : "bg-muted"
          }
        >
          {isUser ? <User className="size-4" /> : <Bot className="size-4" />}
        </AvatarFallback>
      </Avatar>
      <div
        className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
          isUser ? "bg-primary text-primary-foreground" : "bg-muted"
        }`}
      >
        <div className="whitespace-pre-wrap">{textContent}</div>
      </div>
    </div>
  )
}
