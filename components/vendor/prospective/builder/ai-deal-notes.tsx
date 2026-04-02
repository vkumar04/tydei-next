import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import {
  Sparkles,
  Loader2,
  Target,
  FileText,
  Clock,
  Users,
  AlertTriangle,
} from "lucide-react"
import type { NewProposalState, AiSuggestionsState } from "./types"

export interface AiDealNotesProps {
  newProposal: NewProposalState
  setNewProposal: React.Dispatch<React.SetStateAction<NewProposalState>>
  aiSuggestions: AiSuggestionsState
  lastAnalyzedRef: React.MutableRefObject<string>
  analyzeTheDeal: () => void
  onGenerateTermsFromNotes: () => void
}

export function AiDealNotes({
  newProposal,
  setNewProposal,
  aiSuggestions,
  lastAnalyzedRef,
  analyzeTheDeal,
  onGenerateTermsFromNotes,
}: AiDealNotesProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-primary" />
        <Label className="text-base font-semibold">AI Deal Notes</Label>
        <Badge variant="outline" className="text-xs">Optional</Badge>
      </div>
      <p className="text-sm text-muted-foreground">
        Add context about this deal - competitor info, customer priorities, urgency, relationship history.
        AI will analyze these notes to generate deal terms and scoring insights.
      </p>
      <Textarea
        placeholder="Example: Customer is evaluating a competing offer from MedTech Corp at 15% lower pricing. They're interested in a 3-year exclusive partnership if we can match the price. Decision needed by end of month. Strong relationship with their orthopedic department - they've been a customer for 5 years."
        value={newProposal.aiNotes}
        onChange={(e) => setNewProposal(prev => ({ ...prev, aiNotes: e.target.value }))}
        className="min-h-[100px] resize-none"
      />

      <p className="text-xs text-muted-foreground">
        Enter deal context then click the button below to generate terms automatically.
      </p>

      {/* Generate AI Terms Button */}
      {newProposal.aiNotes.trim() ? (
        <Button
          variant="default"
          className="mt-3 gap-2 w-full"
          onClick={onGenerateTermsFromNotes}
        >
          <Sparkles className="h-4 w-4" />
          Generate Deal Terms from Notes
        </Button>
      ) : (
        <Button
          variant="outline"
          className="mt-3 gap-2 w-full"
          disabled
        >
          <Sparkles className="h-4 w-4" />
          Enter notes above to generate terms
        </Button>
      )}

      {/* Auto-analysis hint */}
      {newProposal.products.filter(p => p.proposedPrice > 0).length === 0 && (
        <p className="text-xs text-muted-foreground mt-2">
          Upload pricing and usage files to get AI-powered deal analysis and negotiation suggestions.
        </p>
      )}

      {/* AI Analysis Loading State */}
      {aiSuggestions.isLoading && (
        <div className="mt-3 p-4 rounded-lg bg-muted/50 border border-dashed">
          <div className="flex items-center gap-3">
            <Loader2 className="h-5 w-5 text-primary animate-spin" />
            <div>
              <p className="text-sm font-medium">Analyzing your deal...</p>
              <p className="text-xs text-muted-foreground">Generating negotiation strategies and term suggestions</p>
            </div>
          </div>
        </div>
      )}

      {/* AI Suggestions Display */}
      {aiSuggestions.data && !aiSuggestions.isLoading && (
        <div className="mt-3 space-y-3">
          {/* Deal Strength Header */}
          <div className={`p-3 rounded-lg border ${
            aiSuggestions.data.dealStrength === "strong"
              ? "bg-green-50 dark:bg-green-950/30 border-green-300 dark:border-green-700"
              : aiSuggestions.data.dealStrength === "weak"
              ? "bg-red-50 dark:bg-red-950/30 border-red-300 dark:border-red-700"
              : "bg-amber-50 dark:bg-amber-950/30 border-amber-300 dark:border-amber-700"
          }`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className={`h-4 w-4 ${
                  aiSuggestions.data.dealStrength === "strong"
                    ? "text-green-600 dark:text-green-400"
                    : aiSuggestions.data.dealStrength === "weak"
                    ? "text-red-600 dark:text-red-400"
                    : "text-amber-600 dark:text-amber-400"
                }`} />
                <span className="text-sm font-semibold">
                  Deal Strength: {(aiSuggestions.data.dealStrength || "moderate").charAt(0).toUpperCase() + (aiSuggestions.data.dealStrength || "moderate").slice(1)}
                </span>
              </div>
              {aiSuggestions.data.recommendedDiscount && (
                <Badge variant="outline" className="text-xs">
                  Suggested Discount: {aiSuggestions.data.recommendedDiscount}
                </Badge>
              )}
            </div>
          </div>

          {/* Negotiation Advice */}
          {aiSuggestions.data.negotiationAdvice && aiSuggestions.data.negotiationAdvice.length > 0 && (
            <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800">
              <p className="text-xs font-semibold text-blue-700 dark:text-blue-400 mb-2 flex items-center gap-1">
                <Target className="h-3 w-3" />
                Negotiation Tactics
              </p>
              <ul className="text-xs text-blue-600 dark:text-blue-300 space-y-1">
                {aiSuggestions.data.negotiationAdvice.map((advice: string, i: number) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="text-blue-400">&bull;</span>
                    <span>{advice}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Suggested Terms */}
          {aiSuggestions.data.suggestedTerms && aiSuggestions.data.suggestedTerms.length > 0 && (
            <div className="p-3 rounded-lg bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800">
              <p className="text-xs font-semibold text-green-700 dark:text-green-400 mb-2 flex items-center gap-1">
                <FileText className="h-3 w-3" />
                Suggested Terms
              </p>
              <div className="space-y-2">
                {aiSuggestions.data.suggestedTerms.map((term, i) => (
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
          {aiSuggestions.data.urgencyAssessment && (
            <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
              <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 mb-1 flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Timeline Assessment
              </p>
              <p className="text-xs text-amber-600 dark:text-amber-300">{aiSuggestions.data.urgencyAssessment}</p>
            </div>
          )}

          {/* Competitive Strategy */}
          {aiSuggestions.data.competitiveStrategy && (
            <div className="p-3 rounded-lg bg-purple-50 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800">
              <p className="text-xs font-semibold text-purple-700 dark:text-purple-400 mb-1 flex items-center gap-1">
                <Users className="h-3 w-3" />
                Competitive Strategy
              </p>
              <p className="text-xs text-purple-600 dark:text-purple-300">{aiSuggestions.data.competitiveStrategy}</p>
            </div>
          )}

          {/* Risk Factors */}
          {aiSuggestions.data.riskFactors && aiSuggestions.data.riskFactors.length > 0 && (
            <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800">
              <p className="text-xs font-semibold text-red-700 dark:text-red-400 mb-1 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" />
                Risk Factors
              </p>
              <ul className="text-xs text-red-600 dark:text-red-300 space-y-1">
                {aiSuggestions.data.riskFactors.map((risk: string, i: number) => (
                  <li key={i}>&bull; {risk}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Re-analyze button */}
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-xs"
            onClick={() => {
              lastAnalyzedRef.current = ""
              analyzeTheDeal()
            }}
          >
            Re-analyze with updated notes
          </Button>
        </div>
      )}
    </div>
  )
}
