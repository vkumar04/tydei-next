"use client"

import { useState } from "react"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"

/**
 * Charles 2026-06-06 — cross-vendor reference-number entry with chip
 * display. Reference numbers (manufacturer / cross-vendor catalog numbers)
 * are the robust key for matching a group's purchases regardless of
 * per-vendor name/SKU drift: the COG matcher falls back from per-vendor
 * SKU to manufacturerNo → ContractTerm.referenceNumbers (see
 * lib/contracts/match.ts). Until this input existed there was no capture
 * path, so the fallback was dead in practice.
 *
 * Comma / newline / Enter all commit. Each token is trimmed; blanks are
 * dropped; duplicates are skipped. We preserve the user's exact casing and
 * separators (e.g. "6-820-00") — match-time normalization owns
 * format-robustness, storage keeps the literal reference number. Mirrors
 * the read-only "REF Numbers" chip row in contract-terms-display.tsx.
 */
export function ReferenceNumberList({
  values,
  onChange,
}: {
  values: string[]
  onChange: (next: string[]) => void
}) {
  const [draft, setDraft] = useState("")

  function commit(raw: string) {
    const tokens = raw
      .split(/[\s,]+/)
      .map((t) => t.trim())
      .filter(Boolean)
    if (tokens.length === 0) return
    const next = [...values]
    for (const t of tokens) if (!next.includes(t)) next.push(t)
    onChange(next)
    setDraft("")
  }

  return (
    <div className="space-y-2">
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault()
            commit(draft)
          }
        }}
        onBlur={() => {
          if (draft.trim()) commit(draft)
        }}
        placeholder="e.g. 6-820-00, REF-1234 (Enter or comma to add)"
      />
      {values.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {values.map((ref) => (
            <Badge key={ref} variant="secondary" className="pr-1">
              <span className="text-xs font-mono">{ref}</span>
              <button
                type="button"
                className="ml-1 rounded px-1 hover:bg-accent"
                aria-label={`Remove ${ref}`}
                onClick={() => onChange(values.filter((r) => r !== ref))}
              >
                ×
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  )
}
