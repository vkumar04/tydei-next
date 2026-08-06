"use client"

import {
  SparklesIcon,
  CheckCircle2Icon,
  ChevronRightIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

interface MassUploadInstructionsPanelProps {
  showInstructionsInput: boolean
  onToggleInstructions: () => void
  userInstructions: string
  onUserInstructionsChange: (value: string) => void
  isProcessing: boolean
}

/**
 * "Add Instructions for AI" toggle + textarea + quick prompts, and the
 * active-instructions indicator shown while processing. Renders as a
 * fragment so both blocks stay direct children of the parent's space-y-6
 * container (identical DOM to the pre-split inline JSX).
 */
export function MassUploadInstructionsPanel({
  showInstructionsInput,
  onToggleInstructions,
  userInstructions,
  onUserInstructionsChange,
  isProcessing,
}: MassUploadInstructionsPanelProps) {
  return (
    <>
      {/* User Instructions */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggleInstructions}
            className="gap-2 text-muted-foreground hover:text-foreground -ml-2"
          >
            <SparklesIcon className="h-4 w-4" />
            {showInstructionsInput ? "Hide Instructions" : "Add Instructions for AI"}
            <ChevronRightIcon
              className={`h-4 w-4 transition-transform ${showInstructionsInput ? "rotate-90" : ""}`}
            />
          </Button>
          {userInstructions && !showInstructionsInput && (
            <Badge variant="secondary" className="gap-1">
              <CheckCircle2Icon className="h-3 w-3" />
              Instructions added
            </Badge>
          )}
        </div>

        {showInstructionsInput && (
          <div className="space-y-3 p-4 bg-muted/50 rounded-lg border">
            <div className="space-y-1">
              <Label htmlFor="user-instructions" className="text-sm font-medium">
                Describe what you want the system to do
              </Label>
              <p className="text-xs text-muted-foreground">
                Help the AI understand your intent — what type of data, how to
                process it, and any special considerations
              </p>
            </div>
            <Textarea
              id="user-instructions"
              placeholder="Example: 'These are Q1 2024 invoices from Stryker for our orthopedic department.'"
              value={userInstructions}
              onChange={(e) => onUserInstructionsChange(e.target.value)}
              className="min-h-[80px] resize-none"
              disabled={isProcessing}
            />
            <div className="flex flex-wrap gap-2">
              <span className="text-xs text-muted-foreground self-center">
                Quick prompts:
              </span>
              {[
                {
                  label: "Contracts",
                  text:
                    "These are contract documents. Extract vendor name, effective dates, rebate tiers, and pricing terms.",
                },
                {
                  label: "Invoices",
                  text:
                    "These are invoices. Extract vendor, invoice number, line items, quantities, and prices.",
                },
                {
                  label: "COG Data",
                  text:
                    "This is COG (Cost of Goods) data. Import all line items and flag duplicates.",
                },
                {
                  label: "Pricing",
                  text:
                    "These are pricing schedules. Extract all product pricing, effective dates, and tier structures.",
                },
              ].map((p) => (
                <Button
                  key={p.label}
                  variant="outline"
                  size="sm"
                  className="text-xs h-7"
                  onClick={() => onUserInstructionsChange(p.text)}
                  disabled={isProcessing}
                >
                  {p.label}
                </Button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Active instructions indicator */}
      {userInstructions && isProcessing && (
        <div className="p-3 bg-primary/5 border border-primary/20 rounded-lg">
          <div className="flex items-start gap-2">
            <SparklesIcon className="h-4 w-4 text-primary mt-0.5 shrink-0" />
            <div className="space-y-1">
              <p className="text-xs font-medium text-primary">
                AI Instructions Active
              </p>
              <p className="text-xs text-muted-foreground">{userInstructions}</p>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
