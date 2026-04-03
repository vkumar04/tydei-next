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
import {
  CONTRACT_DEFINITIONS,
  contractTypeDefinitions,
  rebateTypeDefinitions,
  performancePeriodDefinitions,
} from "@/lib/contract-definitions"

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

// ─── Pre-built helper components ────────────────────────────────

export function ContractTypeInfo({ type }: { type: string }) {
  const def = contractTypeDefinitions[type as keyof typeof contractTypeDefinitions]
  if (!def) return <Badge variant="outline">{type}</Badge>
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="outline" className="cursor-help gap-1">
            {def.label}
            <HelpCircle className="h-3 w-3" />
          </Badge>
        </TooltipTrigger>
        <TooltipContent className="max-w-[300px]">
          <p className="font-medium text-sm">{def.label}</p>
          <p className="text-xs text-muted-foreground mt-1">{def.description}</p>
          {def.bestFor && (
            <p className="text-xs mt-1">
              <span className="font-medium">Best for: </span>
              {def.bestFor}
            </p>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export function RebateTypeInfo({ type }: { type: string }) {
  const def = rebateTypeDefinitions[type as keyof typeof rebateTypeDefinitions]
  if (!def) return <Badge variant="outline">{type}</Badge>
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="outline" className="cursor-help gap-1">
            {def.label}
            <HelpCircle className="h-3 w-3" />
          </Badge>
        </TooltipTrigger>
        <TooltipContent className="max-w-[300px]">
          <p className="font-medium text-sm">{def.label}</p>
          <p className="text-xs text-muted-foreground mt-1">{def.description}</p>
          {def.formula && (
            <p className="text-xs font-mono bg-muted/50 rounded px-2 py-1 mt-1">
              {def.formula}
            </p>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export function PerformancePeriodInfo({ period }: { period: string }) {
  const def = performancePeriodDefinitions[period as keyof typeof performancePeriodDefinitions]
  if (!def) return <Badge variant="outline">{period}</Badge>
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="outline" className="cursor-help gap-1">
            {def.label}
            <HelpCircle className="h-3 w-3" />
          </Badge>
        </TooltipTrigger>
        <TooltipContent className="max-w-[300px]">
          <p className="font-medium text-sm">{def.label}</p>
          <p className="text-xs text-muted-foreground mt-1">{def.description}</p>
          <div className="grid grid-cols-2 gap-2 mt-1 text-xs">
            {def.pros && (
              <div>
                <p className="font-medium text-green-600 dark:text-green-400">Pros</p>
                <ul className="text-muted-foreground list-disc list-inside">
                  {def.pros.map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              </div>
            )}
            {def.cons && (
              <div>
                <p className="font-medium text-amber-600 dark:text-amber-400">Cons</p>
                <ul className="text-muted-foreground list-disc list-inside">
                  {def.cons.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
