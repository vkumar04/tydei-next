"use client"

import { useState } from "react"
import { Loader2, Wand2, Sparkles, CheckCircle2, Info } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { AIExtractReview } from "@/components/contracts/ai-extract-review"
import type { ExtractedContractData } from "@/lib/ai/schemas"

interface AITextExtractProps {
  onExtracted: (data: ExtractedContractData) => void
}

type Stage = "input" | "extracting" | "review"

const EXAMPLE_PROMPTS = [
  "3-year usage contract with Stryker Orthopaedics starting January 1, 2026. Tiered rebates: $100K gets 3%, $250K gets 5%, $500K gets 7%. Quarterly performance review.",
  "Zimmer Biomet pricing agreement for hip and knee implants, effective April 2026 through March 2029. 2% rebate at $200K, 4% at $500K.",
  "Capital equipment agreement with DJO for surgical power tools, $500,000 total value over 5 years starting June 2026.",
]

export function AITextExtract({ onExtracted }: AITextExtractProps) {
  const [text, setText] = useState("")
  const [stage, setStage] = useState<Stage>("input")
  const [extracted, setExtracted] = useState<ExtractedContractData | null>(null)
  const [confidence, setConfidence] = useState(0)
  const [error, setError] = useState("")

  async function handleExtract() {
    if (!text.trim()) return
    setStage("extracting")
    setError("")

    try {
      const res = await fetch("/api/ai/extract-contract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text.trim() }),
      })

      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(
          (body as { error?: string } | null)?.error || "Extraction failed"
        )
      }

      const data = await res.json()
      setExtracted(data.extracted)
      setConfidence(data.confidence)
      setStage("review")
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to extract contract data. Please try again."
      )
      setStage("input")
    }
  }

  function handleAccept(data: ExtractedContractData) {
    onExtracted(data)
    setStage("input")
    setText("")
    setExtracted(null)
  }

  return (
    <Card className="border-primary/20 bg-gradient-to-r from-primary/5 to-transparent">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" />
          Describe Your Contract
        </CardTitle>
        <CardDescription>
          Describe the contract in plain English and AI will extract the
          structured fields automatically.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {stage === "input" && (
          <>
            <div className="flex gap-3">
              <Textarea
                placeholder="Example: '3-year usage contract with Stryker starting January 2026. Tiered rebates: $100K gets 3%, $250K gets 5%, $500K gets 7%. Quarterly performance review, rebates paid quarterly.'"
                value={text}
                onChange={(e) => setText(e.target.value)}
                className="min-h-[120px] flex-1"
              />
              <Button
                onClick={handleExtract}
                disabled={!text.trim()}
                className="self-end"
              >
                <Wand2 className="mr-2 h-4 w-4" />
                Extract
              </Button>
            </div>

            {error && (
              <div className="rounded-lg p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
                <div className="flex items-start gap-2">
                  <Info className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                  <p className="text-sm text-amber-700 dark:text-amber-300">
                    {error}
                  </p>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                Example descriptions:
              </p>
              <div className="flex flex-wrap gap-2">
                {EXAMPLE_PROMPTS.map((prompt, i) => (
                  <Badge
                    key={i}
                    variant="outline"
                    className="cursor-pointer hover:bg-muted/50 text-xs font-normal max-w-full"
                    onClick={() => setText(prompt)}
                  >
                    <span className="truncate">{prompt.substring(0, 60)}...</span>
                  </Badge>
                ))}
              </div>
            </div>
          </>
        )}

        {stage === "extracting" && (
          <div className="flex flex-col items-center gap-4 py-8">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">
              AI is extracting contract details from your description...
            </p>
            <p className="text-xs text-muted-foreground">
              This may take a few seconds
            </p>
          </div>
        )}

        {stage === "review" && extracted && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-800 dark:bg-emerald-950">
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              <p className="text-sm text-emerald-700 dark:text-emerald-300">
                Contract details extracted successfully. Review below and accept
                to populate the form.
              </p>
            </div>
            <AIExtractReview
              extracted={extracted}
              confidence={confidence}
              onAccept={handleAccept}
            />
          </div>
        )}
      </CardContent>
    </Card>
  )
}
