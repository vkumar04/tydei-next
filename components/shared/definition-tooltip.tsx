"use client"

import type { ReactNode } from "react"
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@/components/ui/tooltip"
import { CONTRACT_DEFINITIONS } from "@/lib/contract-definitions"

interface DefinitionTooltipProps {
  term: string
  children: ReactNode
}

export function DefinitionTooltip({ term, children }: DefinitionTooltipProps) {
  const definition = CONTRACT_DEFINITIONS[term]

  if (!definition) {
    return <>{children}</>
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="cursor-help border-b border-dotted border-muted-foreground/50">
            {children}
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-[300px] text-sm">
          {definition}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
