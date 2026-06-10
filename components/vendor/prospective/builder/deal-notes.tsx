import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import {
  NotebookPen,
  Target,
  FileText,
  Clock,
  Users,
  AlertTriangle,
} from "lucide-react"
import type { NewProposalState, TermSuggestionsState } from "./types"

export interface DealNotesProps {
  newProposal: NewProposalState
  setNewProposal: React.Dispatch<React.SetStateAction<NewProposalState>>
  termSuggestions: TermSuggestionsState
  onGenerateTermsFromNotes: () => void
}

export function DealNotes({
  newProposal,
  setNewProposal,
  termSuggestions,
  onGenerateTermsFromNotes,
}: DealNotesProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <NotebookPen className="h-4 w-4 text-primary" />
        <Label className="text-base font-semibold">Deal Notes</Label>
        <Badge variant="outline" className="text-xs">Optional</Badge>
      </div>
      <p className="text-sm text-muted-foreground">
        Add context about this deal - competitor info, customer priorities, urgency, relationship history.
        Rule-based keyword matching scans these notes to suggest deal terms.
      </p>
      <Textarea
        placeholder="Example: Customer is evaluating a competing offer from MedTech Corp at 15% lower pricing. They're interested in a 3-year exclusive partnership if we can match the price. Decision needed by end of month. Strong relationship with their orthopedic department - they've been a customer for 5 years."
        value={newProposal.aiNotes}
        onChange={(e) => setNewProposal(prev => ({ ...prev, aiNotes: e.target.value }))}
        className="min-h-[100px] resize-none"
      />

      <p className="text-xs text-muted-foreground">
        Enter deal context then click the button below to get rule-based term suggestions.
      </p>

      {/* Suggest Terms Button */}
      {newProposal.aiNotes.trim() ? (
        <Button
          variant="default"
          className="mt-3 gap-2 w-full"
          onClick={onGenerateTermsFromNotes}
        >
          <NotebookPen className="h-4 w-4" />
          Suggest Terms from Notes (rule-based)
        </Button>
      ) : (
        <Button
          variant="outline"
          className="mt-3 gap-2 w-full"
          disabled
        >
          <NotebookPen className="h-4 w-4" />
          Enter notes above to get suggested terms
        </Button>
      )}

      {/* Term Suggestions Display */}
      {termSuggestions.data && (
        <div className="mt-3 space-y-3">
          {/* Deal Strength Header */}
          <div className={`p-3 rounded-lg border ${
            termSuggestions.data.dealStrength === "strong"
              ? "bg-green-50 dark:bg-green-950/30 border-green-300 dark:border-green-700"
              : termSuggestions.data.dealStrength === "weak"
              ? "bg-red-50 dark:bg-red-950/30 border-red-300 dark:border-red-700"
              : "bg-amber-50 dark:bg-amber-950/30 border-amber-300 dark:border-amber-700"
          }`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Target className={`h-4 w-4 ${
                  termSuggestions.data.dealStrength === "strong"
                    ? "text-green-600 dark:text-green-400"
                    : termSuggestions.data.dealStrength === "weak"
                    ? "text-red-600 dark:text-red-400"
                    : "text-amber-600 dark:text-amber-400"
                }`} />
                <span className="text-sm font-semibold">
                  Deal Strength: {(termSuggestions.data.dealStrength || "moderate").charAt(0).toUpperCase() + (termSuggestions.data.dealStrength || "moderate").slice(1)}
                </span>
              </div>
              {termSuggestions.data.recommendedDiscount && (
                <Badge variant="outline" className="text-xs">
                  Suggested Discount: {termSuggestions.data.recommendedDiscount}
                </Badge>
              )}
            </div>
          </div>

          {/* Negotiation Advice */}
          {termSuggestions.data.negotiationAdvice && termSuggestions.data.negotiationAdvice.length > 0 && (
            <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800">
              <p className="text-xs font-semibold text-blue-700 dark:text-blue-400 mb-2 flex items-center gap-1">
                <Target className="h-3 w-3" />
                Negotiation Tactics
              </p>
              <ul className="text-xs text-blue-600 dark:text-blue-300 space-y-1">
                {termSuggestions.data.negotiationAdvice.map((advice: string, i: number) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="text-blue-400">&bull;</span>
                    <span>{advice}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Suggested Terms */}
          {termSuggestions.data.suggestedTerms && termSuggestions.data.suggestedTerms.length > 0 && (
            <div className="p-3 rounded-lg bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800">
              <p className="text-xs font-semibold text-green-700 dark:text-green-400 mb-2 flex items-center gap-1">
                <FileText className="h-3 w-3" />
                Suggested Terms (rule-based)
              </p>
              <div className="space-y-2">
                {termSuggestions.data.suggestedTerms.map((term, i) => (
                  <div key={i} className="text-xs">
                    <p className="font-medium text-green-700 dark:text-green-300">{term.type}</p>
                    <p className="text-green-600 dark:text-green-400">{term.description}</p>
                    <p className="text-green-500 dark:text-green-500 italic text-[10px]">{term.rationale}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Urgency & Timeline */}
          {termSuggestions.data.urgencyAssessment && (
            <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
              <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 mb-1 flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Timeline Assessment
              </p>
              <p className="text-xs text-amber-600 dark:text-amber-300">{termSuggestions.data.urgencyAssessment}</p>
            </div>
          )}

          {/* Competitive Strategy */}
          {termSuggestions.data.competitiveStrategy && (
            <div className="p-3 rounded-lg bg-purple-50 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800">
              <p className="text-xs font-semibold text-purple-700 dark:text-purple-400 mb-1 flex items-center gap-1">
                <Users className="h-3 w-3" />
                Competitive Strategy
              </p>
              <p className="text-xs text-purple-600 dark:text-purple-300">{termSuggestions.data.competitiveStrategy}</p>
            </div>
          )}

          {/* Risk Factors */}
          {termSuggestions.data.riskFactors && termSuggestions.data.riskFactors.length > 0 && (
            <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800">
              <p className="text-xs font-semibold text-red-700 dark:text-red-400 mb-1 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" />
                Risk Factors
              </p>
              <ul className="text-xs text-red-600 dark:text-red-300 space-y-1">
                {termSuggestions.data.riskFactors.map((risk: string, i: number) => (
                  <li key={i}>&bull; {risk}</li>
                ))}
              </ul>
            </div>
          )}

        </div>
      )}
    </div>
  )
}
