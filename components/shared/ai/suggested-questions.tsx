"use client"

import {
  FileText,
  TrendingUp,
  AlertTriangle,
  DollarSign,
  PieChart,
  BarChart3,
} from "lucide-react"
import { Button } from "@/components/ui/button"

// Map label strings to icons
const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  "Contract Performance": FileText,
  "Rebate Analysis": TrendingUp,
  "Alerts Summary": AlertTriangle,
  "Cost Savings": DollarSign,
  "Market Share": PieChart,
  "Surgeon Metrics": BarChart3,
  "Expiring Contracts": FileText,
  "Pricing Benchmarks": DollarSign,
  "Spend Targets": TrendingUp,
}

interface SuggestedQuestionsProps {
  questions: readonly (string | { label: string; question: string })[]
  onSelect: (question: string) => void
}

export function SuggestedQuestions({
  questions,
  onSelect,
}: SuggestedQuestionsProps) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 w-full max-w-3xl">
      {questions.map((item, index) => {
        const isObject = typeof item === "object" && item !== null
        const label = isObject ? item.label : ""
        const question = isObject ? item.question : item
        const Icon = isObject ? iconMap[label] ?? FileText : FileText

        return (
          <Button
            key={index}
            variant="outline"
            className="h-auto p-4 flex flex-col items-start gap-2 text-left"
            onClick={() => onSelect(question)}
          >
            <div className="flex items-center gap-2">
              <Icon className="h-4 w-4 text-primary" />
              <span className="font-medium">{label || question}</span>
            </div>
            {isObject && (
              <span className="text-xs text-muted-foreground line-clamp-2">
                {question}
              </span>
            )}
          </Button>
        )
      })}
    </div>
  )
}
