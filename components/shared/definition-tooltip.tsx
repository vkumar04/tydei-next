"use client"

import type { ReactNode } from "react"
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@/components/ui/tooltip"
import { Badge } from "@/components/ui/badge"
import { HelpCircle } from "lucide-react"
import { CONTRACT_DEFINITIONS } from "@/lib/contract-definitions"

interface DefinitionTooltipProps {
  term: string
  children: ReactNode
  variant?: "icon" | "inline" | "badge"
}

export function DefinitionTooltip({
  term,
  children,
  variant = "inline",
}: DefinitionTooltipProps) {
  const definition = CONTRACT_DEFINITIONS[term]

  if (!definition) {
    return <>{children}</>
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          {variant === "icon" ? (
            <span className="inline-flex items-center gap-1 cursor-help">
              {children}
              <HelpCircle className="h-3.5 w-3.5 text-muted-foreground" />
            </span>
          ) : variant === "badge" ? (
            <Badge variant="outline" className="cursor-help">
              {children}
            </Badge>
          ) : (
            <span className="cursor-help border-b border-dotted border-muted-foreground/50">
              {children}
            </span>
          )}
        </TooltipTrigger>
        <TooltipContent className="max-w-[300px] text-sm">
          {definition}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
