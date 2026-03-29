"use client"

import { MessageSquare } from "lucide-react"
import { Button } from "@/components/ui/button"

interface SuggestedQuestionsProps {
  questions: string[]
  onSelect: (question: string) => void
}

export function SuggestedQuestions({ questions, onSelect }: SuggestedQuestionsProps) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 w-full max-w-3xl">
      {questions.map((q) => (
        <Button
          key={q}
          variant="outline"
          className="h-auto flex-col items-start gap-2 whitespace-normal p-4 text-left"
          onClick={() => onSelect(q)}
        >
          <div className="flex items-center gap-2">
            <MessageSquare className="size-4 text-primary" />
            <span className="text-xs text-muted-foreground line-clamp-2">
              {q}
            </span>
          </div>
        </Button>
      ))}
    </div>
  )
}
