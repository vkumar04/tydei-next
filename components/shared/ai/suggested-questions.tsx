"use client"

import { MessageSquare } from "lucide-react"
import { Button } from "@/components/ui/button"

interface SuggestedQuestionsProps {
  questions: string[]
  onSelect: (question: string) => void
}

export function SuggestedQuestions({ questions, onSelect }: SuggestedQuestionsProps) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {questions.map((q) => (
        <Button
          key={q}
          variant="outline"
          className="h-auto justify-start whitespace-normal px-3 py-2 text-left text-xs"
          onClick={() => onSelect(q)}
        >
          <MessageSquare className="mr-2 size-3.5 shrink-0" />
          {q}
        </Button>
      ))}
    </div>
  )
}
