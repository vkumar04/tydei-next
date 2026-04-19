"use client"

import { HelpCircle } from "lucide-react"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { Definition } from "@/lib/contract-definitions"

interface DefinitionTooltipProps {
  definition: Definition
}

/**
 * Enum-backed definition tooltip for contract form fields.
 *
 * Accepts a structured `Definition` (label + description) rather than
 * a free-form string key, so callers get compile-time coverage of the
 * underlying Prisma enum via the `*_DEFINITIONS` maps in
 * `lib/contract-definitions.ts`.
 */
export function DefinitionTooltip({ definition }: DefinitionTooltipProps) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={`What is ${definition.label}?`}
            className="inline-flex items-center text-muted-foreground hover:text-foreground"
          >
            <HelpCircle className="ml-1 h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          <p className="font-medium">{definition.label}</p>
          <p className="text-xs text-muted-foreground">{definition.description}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
